const withMT = require("@material-tailwind/react/utils/withMT");

/** @type {import('tailwindcss').Config} */
export default withMT({
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx,css}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Roboto", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Oxygen-Sans", "Ubuntu", "Cantarell", '"Helvetica Neue"', "sans-serif"],
        roboto: ["Roboto", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "sans-serif"],
      },
      colors: {
        be: {
          orange: "#f29813",
          "orange-dark": "#d48108",
          navy: "#003c6c",
          "navy-dark": "#002849",
          "navy-darker": "#001a30",
          yellow: "#fdc700",
          cyan: "#13a5dc",
          "dark-gray": "#75787b",
          "light-gray": "#d0d0ce",
        },
      },
    },
  },
  plugins: [],
})

