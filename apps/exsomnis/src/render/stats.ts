import type { FrameStats } from '@/core-native.ts';

const RING_FRAMES = 240;

interface Ring {
  readonly push: (value: number) => void;
  readonly mean: () => number;
  readonly percentile: (fraction: number) => number;
  readonly count: () => number;
}

const makeRing = (): Ring => {
  const values = new Float64Array(RING_FRAMES);
  let length = 0;
  let next = 0;
  return {
    push: (value) => {
      values[next] = value;
      next = (next + 1) % RING_FRAMES;
      length = Math.min(RING_FRAMES, length + 1);
    },
    mean: () => {
      if (length === 0) {
        return 0;
      }
      let total = 0;
      for (let index = 0; index < length; index += 1) {
        total += values[index] ?? 0;
      }
      return total / length;
    },
    percentile: (fraction) => {
      if (length === 0) {
        return 0;
      }
      const sorted = Array.from(values.subarray(0, length)).toSorted((left, right) => left - right);
      const position = Math.min(length - 1, Math.round((length - 1) * fraction));
      return sorted[position] ?? 0;
    },
    count: () => length,
  };
};

export interface StatsSummary {
  readonly frames: number;
  readonly buildMicrosMean: number;
  readonly buildMicrosP95: number;
  readonly drawMicrosMean: number;
  readonly drawMicrosP95: number;
  readonly diffMicrosMean: number;
  readonly diffMicrosP95: number;
  readonly writeMicrosMean: number;
  readonly writeMicrosP95: number;
  readonly frameMicrosMean: number;
  readonly frameMicrosP95: number;
  readonly latencyMicrosMean: number;
  readonly latencyMicrosP95: number;
  readonly latencySamples: number;
  readonly bytesMean: number;
  readonly bytesMax: number;
  readonly bytesTotal: number;
  readonly cellsTotal: number;
  readonly bytesPerChangedCell: number;
}

export interface StatsCollector {
  readonly recordFrame: (
    buildNanos: number,
    presentEndNanos: number,
    inputStampNanos: number | undefined,
  ) => void;
  readonly summarize: (native: FrameStats) => StatsSummary;
}

export const formatStatsSummary = (summary: StatsSummary): string =>
  [
    `frames ${summary.frames}`,
    `build us mean ${summary.buildMicrosMean} p95 ${summary.buildMicrosP95}`,
    `draw us mean ${summary.drawMicrosMean} p95 ${summary.drawMicrosP95}`,
    `diff us mean ${summary.diffMicrosMean} p95 ${summary.diffMicrosP95}`,
    `write us mean ${summary.writeMicrosMean} p95 ${summary.writeMicrosP95}`,
    `frame us mean ${summary.frameMicrosMean} p95 ${summary.frameMicrosP95}`,
    `input to write us mean ${summary.latencyMicrosMean} p95 ${summary.latencyMicrosP95} samples ${summary.latencySamples}`,
    `bytes per frame mean ${summary.bytesMean} max ${summary.bytesMax}`,
    `bytes per changed cell ${summary.bytesPerChangedCell}`,
  ].join('\n');

const round = (value: number): number => Math.round(value * 100) / 100;

export const makeStatsCollector = (): StatsCollector => {
  const build = makeRing();
  const latency = makeRing();

  return {
    recordFrame: (buildNanos, presentEndNanos, inputStampNanos) => {
      build.push(buildNanos / 1000);
      if (inputStampNanos !== undefined) {
        latency.push((presentEndNanos - inputStampNanos) / 1000);
      }
    },
    summarize: (native) => {
      const frameMean =
        build.mean() + native.drawMicrosMean + native.diffMicrosMean + native.writeMicrosMean;
      const frameP95 =
        build.percentile(0.95) +
        native.drawMicrosP95 +
        native.diffMicrosP95 +
        native.writeMicrosP95;
      return {
        frames: native.frames,
        buildMicrosMean: round(build.mean()),
        buildMicrosP95: round(build.percentile(0.95)),
        drawMicrosMean: round(native.drawMicrosMean),
        drawMicrosP95: round(native.drawMicrosP95),
        diffMicrosMean: round(native.diffMicrosMean),
        diffMicrosP95: round(native.diffMicrosP95),
        writeMicrosMean: round(native.writeMicrosMean),
        writeMicrosP95: round(native.writeMicrosP95),
        frameMicrosMean: round(frameMean),
        frameMicrosP95: round(frameP95),
        latencyMicrosMean: round(latency.mean()),
        latencyMicrosP95: round(latency.percentile(0.95)),
        latencySamples: latency.count(),
        bytesMean: round(native.bytesMean),
        bytesMax: native.bytesMax,
        bytesTotal: native.bytesTotal,
        cellsTotal: native.cellsTotal,
        bytesPerChangedCell:
          native.cellsTotal === 0 ? 0 : round(native.bytesTotal / native.cellsTotal),
      };
    },
  };
};
