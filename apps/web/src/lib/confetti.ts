import confetti from 'canvas-confetti';

const COLORS = ['#ff7a1a', '#00a99d', '#e0388b', '#6c4bf4', '#ffc83d', '#ffffff'];
// above the host dock (z-40), below dialogs such as the report (z-50)
const base = { colors: COLORS, disableForReducedMotion: true, zIndex: 45 };

/** bumped by stopConfetti() so a running shower() stops firing */
let generation = 0;

export function burst(origin = { x: 0.5, y: 0.55 }, particleCount = 140) {
  void confetti({ ...base, particleCount, spread: 90, startVelocity: 45, origin });
}

/** Two cannons from the bottom corners, for the winner */
export function shower(durationMs = 3000) {
  const gen = generation;
  const end = Date.now() + durationMs;
  const frame = () => {
    if (gen !== generation) return;
    void confetti({ ...base, particleCount: 5, angle: 60, spread: 60, origin: { x: 0, y: 0.8 } });
    void confetti({ ...base, particleCount: 5, angle: 120, spread: 60, origin: { x: 1, y: 0.8 } });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}

/** Clears the screen at once, e.g. when a dialog opens over the podium */
export function stopConfetti() {
  generation++;
  confetti.reset();
}
