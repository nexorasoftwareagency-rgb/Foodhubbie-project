// === src/components/shared/AudioPlayer.tsx ===
import { useCallback, useRef } from "react";
import alertSoundUrl from "@/assets/sounds/alert.mp3";

/** Plays the new-order ping alert. Returns a callback ref-safe play() function. */
export function useAlertSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(() => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio(alertSoundUrl);
        audioRef.current.volume = 0.85;
      }
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => {
        // Autoplay can be blocked until the user interacts with the page at least once —
        // this is expected on first load and not worth surfacing as an error.
      });
    } catch {
      /* no-op */
    }
  }, []);

  return play;
}

/** Invisible element kept in the tree purely to satisfy the "AudioPlayer component" slot in the PRD; the real playback is triggered imperatively via useAlertSound(). */
export function AudioPlayer() {
  return <audio preload="auto" src={alertSoundUrl} className="hidden" aria-hidden="true" />;
}
