/**
 * The faces the app is set in (imported in app/layout.tsx), in both scripts it writes: Thai, and the Latin of numbers
 * and names. A browser fetches a face only once some text on screen needs it, and shows that text in another font
 * until it is in. So a word that first comes up at a big moment, "พร้อมแล้ว!" in heavy Kanit as the room fills, would
 * pop up in the wrong font and then jump to the right one. They all come in early instead, while the page is idle.
 */
const FACES = ['400 16px Kanit', '600 16px Kanit', '800 16px Kanit', '400 16px "IBM Plex Sans Thai"', '600 16px "IBM Plex Sans Thai"'];

export function warmFonts() {
  if (typeof document === 'undefined' || !document.fonts) return;
  const go = () => FACES.forEach((face) => void document.fonts.load(face, 'กA').catch(() => {}));
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 2000 });
  else setTimeout(go, 500);
}
