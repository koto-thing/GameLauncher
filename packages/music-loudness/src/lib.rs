//! Thin offline measurement boundary; all DSP belongs to LoudnessMeter.
use loudness_core::{
    application::MeasurementSession,
    domain::{ChannelLayout, LoudnessValue, MeterConfig, PcmFormat, TruePeakValue},
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct TrackMeter {
    session: MeasurementSession,
}

#[wasm_bindgen]
impl TrackMeter {
    /// Allocate history for the entire track before processing any PCM.
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: u32, channels: usize, seconds: f64) -> Result<TrackMeter, JsValue> {
        let layout = match channels {
            1 => ChannelLayout::Mono,
            2 => ChannelLayout::Stereo,
            _ => return Err(JsValue::from_str("Only mono and stereo are supported")),
        };
        if !seconds.is_finite() || seconds <= 0.0 || seconds > 600.0 {
            return Err(JsValue::from_str("Invalid measurement duration"));
        }
        let config = MeterConfig::new(sample_rate, channels, layout, PcmFormat::Interleaved)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let mut session = MeasurementSession::new(config, (seconds * 10.0).ceil() as usize + 1);
        session
            .start()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(Self { session })
    }

    /// Consume a bounded chunk without changing the source audio.
    pub fn process(&mut self, samples: &[f32]) -> Result<(), JsValue> {
        self.session
            .process_interleaved(samples)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Freeze the full-track measurement before reading the result.
    pub fn finish(&mut self) -> Result<(), JsValue> {
        self.session
            .finish()
            .map(|_| ())
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn integrated_lufs(&self) -> Option<f64> {
        match self.session.result().measurement.integrated {
            LoudnessValue::Valid(value) => Some(value),
            LoudnessValue::Unavailable(_) => None,
        }
    }

    pub fn true_peak_dbtp(&self) -> Option<f64> {
        match self.session.result().measurement.true_peak.maximum {
            TruePeakValue::Valid(value) if value.is_finite() => Some(value),
            TruePeakValue::Valid(_) => None,
            TruePeakValue::Unavailable(_) => None,
        }
    }
}
