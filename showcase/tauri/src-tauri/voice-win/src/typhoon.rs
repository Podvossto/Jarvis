// Thai speech: Typhoon ASR Real-time (SCB 10X, CC BY 4.0), a 115M FastConformer RNN-T, in the ONNX export
// huggingface.co/wannaphong/typhoon-asr-realtime-onnx. parakeet-rs can't run it (its TDT loader is fixed at 128 mel
// bands and a two-layer predictor; this model has 80 and one), so the features and the greedy decoding are here,
// following PyThaiASR's reference (pythaiasr/typhoon.py). Runs through the ONNX Runtime that parakeet-rs brings.
//
// A model folder holds encoder-model.onnx, decoder_joint-model.onnx and vocab.json (a JSON array of pieces; the
// blank is one past the last).

use parakeet_rs::ort::session::Session;
use parakeet_rs::ort::value::Tensor;
use parakeet_rs::ExecutionConfig;
use rustfft::num_complex::Complex32;
use rustfft::{Fft, FftPlanner};
use std::path::Path;
use std::sync::Arc;

const N_FFT: usize = 512;
const WIN: usize = 400;
const HOP: usize = 160;
const MELS: usize = 80;
const BINS: usize = N_FFT / 2 + 1;
const PREEMPH: f32 = 0.97;
const HIDDEN: usize = 640;
const MAX_SYMBOLS: usize = 10;
const SPECIAL: [&str; 6] = ["<unk>", "<s>", "</s>", "<pad>", "<bos>", "<eos>"];

pub struct Typhoon {
    encoder: Session,
    joint: Session,
    vocab: Vec<String>,
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    filters: Vec<f32>, // MELS x BINS
}

pub fn present(dir: &Path) -> bool {
    ["vocab.json", "encoder-model.onnx", "decoder_joint-model.onnx"].iter().all(|f| dir.join(f).is_file())
}

fn hz_to_mel(f: f64) -> f64 {
    let (f_sp, min_log_hz) = (200.0 / 3.0, 1000.0);
    if f >= min_log_hz { min_log_hz / f_sp + (f / min_log_hz).ln() / (6.4f64.ln() / 27.0) } else { f / f_sp }
}

fn mel_to_hz(m: f64) -> f64 {
    let (f_sp, min_log_hz) = (200.0 / 3.0, 1000.0);
    let min_log_mel = min_log_hz / f_sp;
    if m >= min_log_mel { min_log_hz * ((6.4f64.ln() / 27.0) * (m - min_log_mel)).exp() } else { f_sp * m }
}

/// Slaney-style mel filters with area normalisation (librosa's default, which NeMo uses).
fn mel_filters(rate: f64) -> Vec<f32> {
    let (lo, hi) = (hz_to_mel(0.0), hz_to_mel(rate / 2.0));
    let hz: Vec<f64> = (0..MELS + 2).map(|i| mel_to_hz(lo + (hi - lo) * i as f64 / (MELS + 1) as f64)).collect();
    let mut out = vec![0.0f32; MELS * BINS];
    for m in 0..MELS {
        let norm = 2.0 / (hz[m + 2] - hz[m]);
        for b in 0..BINS {
            let f = b as f64 * rate / N_FFT as f64;
            let w = ((f - hz[m]) / (hz[m + 1] - hz[m])).min((hz[m + 2] - f) / (hz[m + 2] - hz[m + 1])).max(0.0);
            out[m * BINS + b] = (w * norm) as f32;
        }
    }
    out
}

impl Typhoon {
    pub fn load(dir: &Path, config: &ExecutionConfig) -> Result<Self, String> {
        let raw = std::fs::read_to_string(dir.join("vocab.json")).map_err(|e| format!("vocab.json: {e}"))?;
        let vocab: Vec<String> = serde_json::from_str(&raw).map_err(|e| format!("vocab.json: {e}"))?;
        if vocab.is_empty() {
            return Err("vocab.json is empty".into());
        }
        let encoder = config.build_session(&dir.join("encoder-model.onnx")).map_err(|e| e.to_string())?;
        let joint = config.build_session(&dir.join("decoder_joint-model.onnx")).map_err(|e| e.to_string())?;
        // A symmetric Hann window, centred in the FFT frame (what torch.stft does with win_length < n_fft).
        let mut window = vec![0.0f32; N_FFT];
        let start = (N_FFT - WIN) / 2;
        for i in 0..WIN {
            window[start + i] = (0.5 * (1.0 - (2.0 * std::f64::consts::PI * i as f64 / (WIN - 1) as f64).cos())) as f32;
        }
        Ok(Self { encoder, joint, vocab, fft: FftPlanner::new().plan_fft_forward(N_FFT), window, filters: mel_filters(16_000.0) })
    }

    /// Log-mel features, normalised per band: (MELS x frames, row-major by band), and the frame count.
    fn features(&self, audio: &[f32]) -> (Vec<f32>, usize) {
        let mut x = Vec::with_capacity(audio.len());
        x.push(audio[0]);
        x.extend(audio.windows(2).map(|w| w[1] - PREEMPH * w[0]));
        // Reflect padding of half a frame at both ends.
        let pad = N_FFT / 2;
        let n = x.len();
        let at = |i: isize| -> f32 {
            let mut i = i;
            if i < 0 { i = -i; }
            if i >= n as isize { i = 2 * (n as isize - 1) - i; }
            x[i.clamp(0, n as isize - 1) as usize]
        };
        let frames = 1 + n / HOP;
        let mut mel = vec![0.0f32; MELS * frames];
        let mut buf = vec![Complex32::new(0.0, 0.0); N_FFT];
        let mut power = [0.0f32; BINS];
        for t in 0..frames {
            let first = (t * HOP) as isize - pad as isize;
            for (i, c) in buf.iter_mut().enumerate() {
                *c = Complex32::new(at(first + i as isize) * self.window[i], 0.0);
            }
            self.fft.process(&mut buf);
            for (b, p) in power.iter_mut().enumerate() {
                *p = buf[b].norm_sqr();
            }
            for m in 0..MELS {
                let row = &self.filters[m * BINS..(m + 1) * BINS];
                let e: f32 = row.iter().zip(power.iter()).map(|(w, p)| w * p).sum();
                mel[m * frames + t] = (e + 2.0f32.powi(-24)).ln();
            }
        }
        for m in 0..MELS {
            let row = &mut mel[m * frames..(m + 1) * frames];
            let mean = row.iter().sum::<f32>() / frames as f32;
            let std = (row.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / frames as f32).sqrt();
            row.iter_mut().for_each(|v| *v = (*v - mean) / (std + 1e-5));
        }
        (mel, frames)
    }

    pub fn transcribe(&mut self, audio: &[f32]) -> Result<String, String> {
        if audio.len() < N_FFT {
            return Ok(String::new());
        }
        let (mel, frames) = self.features(audio);
        let signal = Tensor::from_array(([1usize, MELS, frames], mel)).map_err(|e| e.to_string())?;
        let length = Tensor::from_array(([1usize], vec![frames as i64])).map_err(|e| e.to_string())?;
        let (dim, steps, enc) = {
            let out = self.encoder.run(parakeet_rs::ort::inputs!("audio_signal" => signal, "length" => length)).map_err(|e| e.to_string())?;
            let (shape, data) = out["outputs"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
            let dims: Vec<usize> = shape.iter().map(|d| *d as usize).collect();
            if dims.len() != 3 {
                return Err(format!("encoder output has shape {dims:?}"));
            }
            let (_, lens) = out["encoded_lengths"].try_extract_tensor::<i64>().map_err(|e| e.to_string())?;
            let steps = (lens.first().copied().unwrap_or(dims[2] as i64).max(0) as usize).min(dims[2]);
            (dims[1], steps, (dims[2], data.to_vec()))
        };
        let (total, enc) = enc;

        let blank = self.vocab.len();
        let (mut h, mut c) = (vec![0.0f32; HIDDEN], vec![0.0f32; HIDDEN]);
        let mut last = blank as i32;
        let mut ids: Vec<usize> = Vec::new();
        for t in 0..steps {
            let frame: Vec<f32> = (0..dim).map(|d| enc[d * total + t]).collect();
            for _ in 0..MAX_SYMBOLS {
                let out = self.joint.run(parakeet_rs::ort::inputs!(
                    "encoder_outputs" => Tensor::from_array(([1usize, dim, 1], frame.clone())).map_err(|e| e.to_string())?,
                    "targets" => Tensor::from_array(([1usize, 1], vec![last])).map_err(|e| e.to_string())?,
                    "target_length" => Tensor::from_array(([1usize], vec![1i32])).map_err(|e| e.to_string())?,
                    "input_states_1" => Tensor::from_array(([1usize, 1, HIDDEN], h.clone())).map_err(|e| e.to_string())?,
                    "input_states_2" => Tensor::from_array(([1usize, 1, HIDDEN], c.clone())).map_err(|e| e.to_string())?
                )).map_err(|e| e.to_string())?;
                let (_, logits) = out["outputs"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
                let best = logits.iter().take(blank + 1).enumerate().max_by(|a, b| a.1.total_cmp(b.1)).map(|(i, _)| i).unwrap_or(blank);
                if best == blank {
                    break;
                }
                ids.push(best);
                last = best as i32;
                h = out["output_states_1"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?.1.to_vec();
                c = out["output_states_2"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?.1.to_vec();
            }
        }
        Ok(self.text(&ids))
    }

    fn text(&self, ids: &[usize]) -> String {
        let joined: String = ids.iter().filter_map(|&i| self.vocab.get(i)).filter(|p| !SPECIAL.contains(&p.as_str())).map(String::as_str).collect();
        // The model writes sara am as its two parts (nikhahit + sara aa); put them back together.
        joined.replace('\u{2581}', " ").replace("\u{0e4d}\u{0e32}", "\u{0e33}").trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mel_scale_round_trips() {
        for f in [0.0, 440.0, 1000.0, 4000.0, 8000.0] {
            assert!((mel_to_hz(hz_to_mel(f)) - f).abs() < 1e-6);
        }
    }

    #[test]
    fn filters_cover_the_band() {
        let f = mel_filters(16_000.0);
        assert_eq!(f.len(), MELS * BINS);
        // Every band has some weight, and none is negative.
        for m in 0..MELS {
            assert!(f[m * BINS..(m + 1) * BINS].iter().sum::<f32>() > 0.0);
        }
        assert!(f.iter().all(|w| *w >= 0.0));
    }
}
