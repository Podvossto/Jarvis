// Wake word: "Hey Jarvis", heard on this PC with openWakeWord (github.com/dscripka/openWakeWord; code Apache-2.0,
// pretrained models CC BY-NC-SA 4.0). Three small ONNX models run one after the other on every 80 ms of sound:
//   melspectrogram.onnx   raw 16 kHz samples (int16 scale) -> 32 mel bands every 10 ms
//   embedding_model.onnx  the last 76 mel frames (760 ms)  -> one 96-number embedding (Google's speech_embedding)
//   hey_jarvis_v0.1.onnx  the last 16 embeddings (1.28 s)   -> a score from 0 to 1
// This follows openwakeword/utils.py (AudioFeatures._streaming_features) and model.py (Model.predict) exactly,
// except that nothing is scored until 16 embeddings of real sound exist (the Python fills the history with the
// embeddings of random noise and zeroes the first 5 scores instead). Runs through the ONNX Runtime that parakeet-rs
// brings, one thread per model.

use parakeet_rs::ort::session::Session;
use parakeet_rs::ort::value::Tensor;
use parakeet_rs::ExecutionConfig;
use std::collections::VecDeque;
use crate::{log, Ev};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender, SyncSender};
use std::sync::Arc;

/// Samples per step: 80 ms at 16 kHz. Every step adds 8 mel frames, one embedding and one score.
pub const CHUNK: usize = 1280;
/// Samples before the step the melspectrogram model also needs (3 hops of 160: its 400-sample window).
const CONTEXT: usize = 480;
const BANDS: usize = 32;
/// Mel frames per embedding, and how far apart embeddings are (8 frames = one step).
const WINDOW: usize = 76;
const EMBED: usize = 96;

/// The model files, as openWakeWord's v0.5.1 release names them.
pub const FILES: [&str; 3] = ["melspectrogram.onnx", "embedding_model.onnx", "hey_jarvis_v0.1.onnx"];

pub fn present(dir: &Path) -> bool {
    FILES.iter().all(|f| dir.join(f).is_file())
}

pub struct Detector {
    mel: Session,
    emb: Session,
    cls: Session,
    mel_in: String,
    emb_in: String,
    cls_in: String,
    /// Embeddings the wake word model reads at once (16 for hey_jarvis, from its input shape).
    frames: usize,
    /// Sound not yet a whole step, at int16 scale.
    pending: Vec<f32>,
    /// The CONTEXT samples just before `pending`.
    context: Vec<f32>,
    mels: VecDeque<[f32; BANDS]>,
    embeds: VecDeque<[f32; EMBED]>,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl Detector {
    pub fn load(dir: &Path, config: &ExecutionConfig) -> Result<Self, String> {
        let open = |f: &str| config.build_session(&dir.join(f)).map_err(|e| format!("{f}: {e}"));
        let (mel, emb, cls) = (open(FILES[0])?, open(FILES[1])?, open(FILES[2])?);
        let name = |s: &Session| s.inputs()[0].name().to_owned();
        let frames = cls.inputs()[0].dtype().tensor_shape().and_then(|s| s.get(1).copied()).filter(|n| *n > 0).unwrap_or(16) as usize;
        let mut d = Detector {
            mel_in: name(&mel),
            emb_in: name(&emb),
            cls_in: name(&cls),
            mel,
            emb,
            cls,
            frames,
            pending: Vec::with_capacity(CHUNK),
            context: Vec::with_capacity(CONTEXT),
            mels: VecDeque::with_capacity(WINDOW + 8),
            embeds: VecDeque::with_capacity(frames + 1),
        };
        d.reset();
        Ok(d)
    }

    /// Forget all sound heard (as AudioFeatures.reset(): the mel history starts as 76 frames of ones).
    pub fn reset(&mut self) {
        self.pending.clear();
        self.context.clear();
        self.mels.clear();
        self.mels.extend(std::iter::repeat([1.0; BANDS]).take(WINDOW));
        self.embeds.clear();
    }

    /// Takes mic samples (16 kHz mono, -1..1) in any piece size; returns the highest score of the steps they
    /// completed, or None when no step completed or it's still warming up (the first 1.28 s after a reset).
    pub fn push(&mut self, samples: &[f32]) -> Result<Option<f32>, String> {
        let mut best: Option<f32> = None;
        for &s in samples {
            self.pending.push((s * 32768.0).clamp(-32768.0, 32767.0));
            if self.pending.len() == CHUNK {
                if let Some(score) = self.step()? {
                    best = Some(best.map_or(score, |b| b.max(score)));
                }
            }
        }
        Ok(best)
    }

    fn step(&mut self) -> Result<Option<f32>, String> {
        // Melspectrogram of the step plus the 480 samples before it: (480 + 1280) / 160 - 3 = 8 new frames
        // (5 on the very first step, which has no context), scaled by x / 10 + 2 as openWakeWord does.
        let mut input = Vec::with_capacity(CONTEXT + CHUNK);
        input.extend_from_slice(&self.context);
        input.extend_from_slice(&self.pending);
        let keep = input.len().saturating_sub(CONTEXT);
        self.context.clear();
        self.context.extend_from_slice(&input[keep..]);
        self.pending.clear();
        let n = input.len();
        {
            let out = self.mel.run(parakeet_rs::ort::inputs![self.mel_in.as_str() => Tensor::from_array(([1usize, n], input)).map_err(err)?]).map_err(err)?;
            let (_, data) = out[0].try_extract_tensor::<f32>().map_err(err)?;
            for f in data.chunks_exact(BANDS) {
                let mut row = [0.0; BANDS];
                for (r, v) in row.iter_mut().zip(f) {
                    *r = v / 10.0 + 2.0;
                }
                self.mels.push_back(row);
            }
        }
        while self.mels.len() > WINDOW {
            self.mels.pop_front();
        }
        // One embedding of the last 76 frames: input (1, 76, 32, 1).
        let window: Vec<f32> = self.mels.iter().flatten().copied().collect();
        let embed = {
            let out = self.emb.run(parakeet_rs::ort::inputs![self.emb_in.as_str() => Tensor::from_array(([1usize, WINDOW, BANDS, 1], window)).map_err(err)?]).map_err(err)?;
            let (_, data) = out[0].try_extract_tensor::<f32>().map_err(err)?;
            let mut e = [0.0; EMBED];
            e.copy_from_slice(&data[..EMBED]);
            e
        };
        self.embeds.push_back(embed);
        while self.embeds.len() > self.frames {
            self.embeds.pop_front();
        }
        if self.embeds.len() < self.frames {
            return Ok(None);
        }
        // The wake word model on the last 16 embeddings: input (1, 16, 96), output (1, 1).
        let feats: Vec<f32> = self.embeds.iter().flatten().copied().collect();
        let out = self.cls.run(parakeet_rs::ort::inputs![self.cls_in.as_str() => Tensor::from_array(([1usize, self.frames, EMBED], feats)).map_err(err)?]).map_err(err)?;
        let (_, data) = out[0].try_extract_tensor::<f32>().map_err(err)?;
        Ok(data.first().copied())
    }
}

/// When the scores count as the wake word: `need` steps in a row at or over `threshold`. One phrase keeps the score
/// up for several steps (about 6 to 9 at 0.5 with the test voices), so after firing it waits for the score to drop
/// below the threshold before it can fire again.
pub struct Trigger {
    pub threshold: f32,
    pub need: usize,
    run: usize,
    fired: bool,
}

impl Trigger {
    pub fn new(threshold: f32, need: usize) -> Self {
        Trigger { threshold, need: need.max(1), run: 0, fired: false }
    }

    pub fn feed(&mut self, score: f32) -> bool {
        if score < self.threshold {
            self.run = 0;
            self.fired = false;
            return false;
        }
        self.run += 1;
        if self.fired || self.run < self.need {
            return false;
        }
        self.fired = true;
        true
    }

    pub fn clear(&mut self) {
        self.run = 0;
        self.fired = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_phrase_fires_once() {
        let mut t = Trigger::new(0.5, 1);
        let fires: Vec<bool> = [0.1, 0.6, 0.9, 0.99, 0.7, 0.2, 0.8].iter().map(|s| t.feed(*s)).collect();
        assert_eq!(fires, [false, true, false, false, false, false, true]);
        let mut p = Trigger::new(0.5, 2);
        let fires: Vec<bool> = [0.6, 0.1, 0.6, 0.6, 0.6].iter().map(|s| p.feed(*s)).collect();
        assert_eq!(fires, [false, false, false, true, false]);
    }
}

// ---------- the listener: its own thread, fed by the microphone while Roamies waits for the wake word ----------

/// At or over this score the phrase counts as said. Scores are close to 0 or close to 1, so the exact bar matters
/// little; one step over it is enough (waiting for more loses real ones and keeps the same false ones).
pub const THRESHOLD: f32 = 0.5;

pub enum Msg {
    Audio(Vec<f32>),
    /// Forget what was heard: sent each time listening starts again.
    Reset,
}

/// The way in for the microphone (audio.rs feeds it while `on`) and for the session (reset).
#[derive(Clone)]
pub struct Wake {
    pub tx: SyncSender<Msg>,
    pub on: Arc<AtomicBool>,
}

impl Wake {
    pub fn set(&self, on: bool) {
        self.on.store(on, Ordering::Relaxed);
    }

    /// Called from the audio callback: never waits (a full queue drops the piece; the detector is far faster than
    /// real time, so that means it has stopped).
    pub fn feed(&self, samples: &[f32]) {
        if self.on.load(Ordering::Relaxed) && !samples.is_empty() {
            let _ = self.tx.try_send(Msg::Audio(samples.to_vec()));
        }
    }
}

/// Starts the listener. The models load on its thread; a failure comes back as Ev::WakeFailed.
pub fn spawn(dir: PathBuf, config: ExecutionConfig, events: Sender<Ev>) -> Wake {
    let (tx, rx) = mpsc::sync_channel::<Msg>(64);
    let on = Arc::new(AtomicBool::new(false));
    let listening = on.clone();
    std::thread::spawn(move || {
        let mut det = match Detector::load(&dir, &config) {
            Ok(d) => d,
            Err(e) => {
                let _ = events.send(Ev::WakeFailed(e));
                return;
            }
        };
        log("wake word model ready");
        let mut trigger = Trigger::new(THRESHOLD, 1);
        while let Ok(msg) = rx.recv() {
            match msg {
                Msg::Reset => {
                    det.reset();
                    trigger.clear();
                }
                Msg::Audio(samples) => {
                    // Sound that was queued before listening was turned off isn't for it.
                    if !listening.load(Ordering::Relaxed) {
                        continue;
                    }
                    match det.push(&samples) {
                        Ok(Some(score)) if trigger.feed(score) => {
                            if events.send(Ev::Wake(score)).is_err() {
                                return;
                            }
                        }
                        Ok(_) => {}
                        Err(e) => {
                            let _ = events.send(Ev::WakeFailed(e));
                            return;
                        }
                    }
                }
            }
        }
    });
    Wake { tx, on }
}
