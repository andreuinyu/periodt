export default [
  {
    files: ["frontend/**/*.js"],
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
      "no-console": "off",
    },
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        // browser
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        console: "readonly",
        localStorage: "readonly",
        setTimeout: "readonly",
        requestAnimationFrame: "readonly",
        atob: "readonly",
        URL: "readonly",
        Response: "readonly",
        Notification: "readonly",
        // service worker
        self: "readonly",
        caches: "readonly",
        clients: "readonly",
      }
    }
  }
];