// Conventional Commits (https://www.conventionalcommits.org): `type(scope): summary`.
// Release-please reads these to pick the next version: `fix` → patch, `feat` → minor,
// `!` or a `BREAKING CHANGE:` footer → major (minor while we are below 1.0).
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Summaries here are often long and specific; bodies carry co-author and session lines.
    'header-max-length': [2, 'always', 150],
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
