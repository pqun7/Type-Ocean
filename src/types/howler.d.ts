declare module "howler" {
  export type HowlOptions = {
    src: string[];
    preload?: boolean;
    html5?: boolean;
    pool?: number;
    volume?: number;
    onloaderror?: (soundId: number, error: unknown) => void;
    onplayerror?: (soundId: number, error: unknown) => void;
  };

  export class Howl {
    constructor(options: HowlOptions);
    play(spriteOrId?: string | number): number;
    volume(volume?: number): number;
    unload(): void;
    once?(event: string, fn: () => void): void;
  }

  export const Howler: {
    ctx?: AudioContext;
  };
}
