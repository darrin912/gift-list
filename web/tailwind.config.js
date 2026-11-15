/** @type {import('tailwindcss').Config} */
const v = (name) => `var(--${name})`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Bricolage Grotesque Variable"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      colors: {
        bg: v("bg"),
        band: v("band"),
        "band-ink": v("band-ink"),
        surface: v("surface"),
        "surface-2": v("surface-2"),
        ink: v("ink"),
        muted: v("muted"),
        line: v("line"),
        pine: v("pine"),
        "pine-ink": v("pine-ink"),
        "pine-soft": v("pine-soft"),
        berry: v("berry"),
        "berry-soft": v("berry-soft"),
        gold: v("gold"),
        "gold-soft": v("gold-soft"),
        "st-idea": v("st-idea"),
        "st-planned": v("st-planned"),
        "st-ordered": v("st-ordered"),
        "st-received": v("st-received"),
        "st-wrapped": v("st-wrapped"),
        "st-given": v("st-given"),
        "st-returned": v("st-returned"),
      },
      borderRadius: { tag: "14px" },
    },
  },
  plugins: [],
};
