/* tslint:disable */
/* eslint-disable */

export class TrackMeter {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Freeze the full-track measurement before reading the result.
     */
    finish(): void;
    integrated_lufs(): number | undefined;
    /**
     * Allocate history for the entire track before processing any PCM.
     */
    constructor(sample_rate: number, channels: number, seconds: number);
    /**
     * Consume a bounded chunk without changing the source audio.
     */
    process(samples: Float32Array): void;
    true_peak_dbtp(): number | undefined;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_trackmeter_free: (a: number, b: number) => void;
    readonly trackmeter_finish: (a: number) => [number, number];
    readonly trackmeter_integrated_lufs: (a: number) => [number, number];
    readonly trackmeter_new: (a: number, b: number, c: number) => [number, number, number];
    readonly trackmeter_process: (a: number, b: number, c: number) => [number, number];
    readonly trackmeter_true_peak_dbtp: (a: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
