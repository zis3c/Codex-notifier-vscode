module.exports = {
  root: true,
  env: {
    es2021: true,
    node: true
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: 2021
  },
  rules: {
    "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }]
  }
};
