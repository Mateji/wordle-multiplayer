import { Injectable } from '@angular/core';

type CountdownGroupState = {
  spec: string;
  sources: AudioBufferSourceNode[];
};

type BrowserAudioContextConstructor = new () => AudioContext;

@Injectable({
  providedIn: 'root',
})
export class AudioService {
  private readonly clipExtensions = ['ogg', 'mp3'] as const;
  private readonly eagerClipNames = [
    'yellow-found',
    'green-found',
    'error',
    'congratulations',
    'you_win',
    'you_lose',
  ] as const;
  private audioContext: AudioContext | null = null;
  private readonly clipBuffers = new Map<string, AudioBuffer>();
  private readonly clipLoads = new Map<string, Promise<AudioBuffer | null>>();
  private readonly countdownGroups = new Map<string, CountdownGroupState>();

  async unlock(): Promise<void> {
    const context = this.getAudioContext();
    if (!context) {
      return;
    }

    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch {
        return;
      }
    }

    await this.preloadNumbers(10);
    await Promise.all(this.eagerClipNames.map((name) => this.loadClip(name)));
  }

  async playClip(name: string): Promise<void> {
    const context = this.getAudioContext();
    if (!context || context.state !== 'running') {
      return;
    }

    const buffer = await this.loadClip(name);
    if (!buffer) {
      return;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      source.disconnect();
    };
    source.start();
  }

  async playSequence(groupName: string, clipNames: string[], spec: string): Promise<void> {
    const context = this.getAudioContext();
    if (!context || context.state !== 'running' || !clipNames.length) {
      return;
    }

    const currentGroup = this.countdownGroups.get(groupName);
    if (currentGroup?.spec === spec) {
      return;
    }

    this.cancelGroup(groupName);
    this.countdownGroups.set(groupName, { spec, sources: [] });

    const buffers = await Promise.all(clipNames.map((name) => this.loadClip(name)));
    const activeGroup = this.countdownGroups.get(groupName);
    if (!activeGroup || activeGroup.spec !== spec) {
      return;
    }

    let nextStartTime = context.currentTime;

    for (const buffer of buffers) {
      if (!buffer) {
        continue;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        source.disconnect();
      };
      source.start(nextStartTime);
      activeGroup.sources.push(source);
      nextStartTime += buffer.duration;
    }
  }

  async preloadNumbers(maxNumber: number): Promise<void> {
    const context = this.getAudioContext();
    if (!context || maxNumber < 1) {
      return;
    }

    await Promise.all(Array.from({ length: maxNumber }, (_, index) => this.loadClip(String(index + 1))));
  }

  async scheduleNumberCountdown(groupName: string, highestNumber: number, endUnixMs: number): Promise<void> {
    const context = this.getAudioContext();
    if (!context || context.state !== 'running' || highestNumber < 1 || !Number.isFinite(endUnixMs)) {
      return;
    }

    const spec = `${highestNumber}:${endUnixMs}`;
    const currentGroup = this.countdownGroups.get(groupName);
    if (currentGroup?.spec === spec) {
      return;
    }

    this.cancelGroup(groupName);
    this.countdownGroups.set(groupName, { spec, sources: [] });

    const clipNames = Array.from({ length: highestNumber }, (_, index) => String(index + 1));
    const buffers = await Promise.all(clipNames.map((name) => this.loadClip(name)));
    const activeGroup = this.countdownGroups.get(groupName);
    if (!activeGroup || activeGroup.spec !== spec) {
      return;
    }

    const nowMs = Date.now();
    const audioNow = context.currentTime;

    for (let number = highestNumber; number >= 1; number--) {
      const buffer = buffers[number - 1];
      if (!buffer) {
        continue;
      }

      const playAtMs = endUnixMs - number * 1000;
      const delayMs = playAtMs - nowMs;
      if (delayMs < -350) {
        continue;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        source.disconnect();
      };
      source.start(audioNow + Math.max(0, delayMs) / 1000);
      activeGroup.sources.push(source);
    }
  }

  cancelGroup(groupName: string): void {
    const group = this.countdownGroups.get(groupName);
    if (!group) {
      return;
    }

    for (const source of group.sources) {
      try {
        source.stop();
      } catch {
        // ignore sources that already ended
      }
      source.disconnect();
    }

    this.countdownGroups.delete(groupName);
  }

  cancelAll(): void {
    for (const groupName of Array.from(this.countdownGroups.keys())) {
      this.cancelGroup(groupName);
    }
  }

  private getAudioContext(): AudioContext | null {
    if (this.audioContext) {
      return this.audioContext;
    }

    if (typeof window === 'undefined') {
      return null;
    }

    const browserWindow = window as Window & typeof globalThis & {
      webkitAudioContext?: BrowserAudioContextConstructor;
    };
    const AudioContextConstructor = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;

    if (!AudioContextConstructor) {
      return null;
    }

    try {
      this.audioContext = new AudioContextConstructor();
    } catch {
      this.audioContext = null;
    }

    return this.audioContext;
  }

  private loadClip(name: string): Promise<AudioBuffer | null> {
    const existingBuffer = this.clipBuffers.get(name);
    if (existingBuffer) {
      return Promise.resolve(existingBuffer);
    }

    const existingLoad = this.clipLoads.get(name);
    if (existingLoad) {
      return existingLoad;
    }

    const context = this.getAudioContext();
    if (!context) {
      return Promise.resolve(null);
    }

    const load = this.fetchAndDecodeClip(context, name)
      .then((buffer) => {
        if (buffer) {
          this.clipBuffers.set(name, buffer);
        }
        return buffer;
      })
      .finally(() => {
        this.clipLoads.delete(name);
      });

    this.clipLoads.set(name, load);
    return load;
  }

  private async fetchAndDecodeClip(context: AudioContext, name: string): Promise<AudioBuffer | null> {
    for (const extension of this.clipExtensions) {
      try {
        const response = await fetch(`/assets/sounds/${name}.${extension}`);
        if (!response.ok) {
          continue;
        }

        const fileBytes = await response.arrayBuffer();
        return await context.decodeAudioData(fileBytes);
      } catch {
        // try the next supported extension
      }
    }

    return null;
  }
}