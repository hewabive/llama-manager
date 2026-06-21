import { strict as assert } from "node:assert";
import test from "node:test";

import {
  computeDiskActivity,
  parseDiskStats,
  parseIoPressure,
  type DiskCounters,
} from "./disk.js";

const SAMPLE = `
   7       0 loop0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
 259       0 nvme0n1 1000 0 4000 800 50 0 200 60 0 700 1400
 259       1 nvme0n1p1 10 0 40 8 1 0 2 1 0 7 14
`;

test("parseDiskStats keeps every device with the canonical column layout", () => {
  const stats = parseDiskStats(SAMPLE);
  assert.equal(stats.size, 3);
  const disk = stats.get("nvme0n1");
  assert.deepEqual(disk, {
    readIos: 1000,
    readSectors: 4000,
    readMs: 800,
    writeIos: 50,
    writeSectors: 200,
    writeMs: 60,
    ioTicks: 700,
  });
});

test("computeDiskActivity derives rates, util and latency from the delta", () => {
  const previous = new Map<string, DiskCounters>([
    [
      "nvme0n1",
      {
        readIos: 0,
        readSectors: 0,
        readMs: 0,
        writeIos: 0,
        writeSectors: 0,
        writeMs: 0,
        ioTicks: 0,
      },
    ],
  ]);
  const current = new Map<string, DiskCounters>([
    [
      "nvme0n1",
      {
        readIos: 100,
        readSectors: 2_000_000,
        readMs: 500,
        writeIos: 0,
        writeSectors: 0,
        writeMs: 0,
        ioTicks: 400,
      },
    ],
  ]);

  const activity = computeDiskActivity({
    previous,
    current,
    intervalMs: 1000,
    names: ["nvme0n1"],
    meta: new Map([
      ["nvme0n1", { type: "ssd", model: "Samsung 990", sizeBytes: 1024 }],
    ]),
    ioPressure: { avg10: 1.5, avg60: 0.5 },
  });

  const device = activity.devices[0]!;
  assert.equal(device.readBytesPerSec, 2_000_000 * 512);
  assert.equal(device.writeBytesPerSec, 0);
  assert.equal(device.readIops, 100);
  assert.equal(device.utilPercent, 40);
  assert.equal(device.avgReadLatencyMs, 5);
  assert.equal(device.avgWriteLatencyMs, null);
  assert.equal(device.type, "ssd");
  assert.equal(activity.totalReadBytesPerSec, 2_000_000 * 512);
  assert.deepEqual(activity.ioPressure, { avg10: 1.5, avg60: 0.5 });
  assert.equal(activity.intervalMs, 1000);
});

test("computeDiskActivity yields null rates without a baseline", () => {
  const current = new Map<string, DiskCounters>([
    [
      "sda",
      {
        readIos: 5,
        readSectors: 10,
        readMs: 1,
        writeIos: 0,
        writeSectors: 0,
        writeMs: 0,
        ioTicks: 2,
      },
    ],
  ]);

  const activity = computeDiskActivity({
    previous: current,
    current,
    intervalMs: 0,
    names: ["sda"],
    meta: new Map(),
    ioPressure: null,
  });

  const device = activity.devices[0]!;
  assert.equal(device.readBytesPerSec, null);
  assert.equal(device.utilPercent, null);
  assert.equal(device.type, "unknown");
  assert.equal(activity.totalReadBytesPerSec, null);
  assert.equal(activity.intervalMs, null);
});

test("computeDiskActivity nulls a device whose counters wrapped or reset", () => {
  const previous = new Map<string, DiskCounters>([
    [
      "sda",
      {
        readIos: 100,
        readSectors: 1000,
        readMs: 50,
        writeIos: 0,
        writeSectors: 0,
        writeMs: 0,
        ioTicks: 100,
      },
    ],
  ]);
  const current = new Map<string, DiskCounters>([
    [
      "sda",
      {
        readIos: 1,
        readSectors: 5,
        readMs: 1,
        writeIos: 0,
        writeSectors: 0,
        writeMs: 0,
        ioTicks: 1,
      },
    ],
  ]);

  const activity = computeDiskActivity({
    previous,
    current,
    intervalMs: 1000,
    names: ["sda"],
    meta: new Map(),
    ioPressure: null,
  });

  assert.equal(activity.devices[0]!.readBytesPerSec, null);
  assert.equal(activity.devices[0]!.utilPercent, null);
});

test("parseIoPressure reads the full-stall averages", () => {
  const pressure = parseIoPressure(
    "some avg10=2.00 avg60=1.00 avg300=0.30 total=123\nfull avg10=1.50 avg60=0.40 avg300=0.10 total=99\n",
  );
  assert.deepEqual(pressure, { avg10: 1.5, avg60: 0.4 });
});

test("parseIoPressure returns null when the full line is absent", () => {
  assert.equal(parseIoPressure("some avg10=2.00 avg60=1.00\n"), null);
});
