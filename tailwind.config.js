/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./views/**/*.ejs', './public/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        accent: '#f43f5e',
        accentLight: '#fb7185',
      },
    },
  },
  plugins: [],
}
