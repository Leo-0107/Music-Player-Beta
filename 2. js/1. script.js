// Main loader: keeps the original JavaScript execution as one exact program
// while the source is physically split into six parts for easier maintenance.
(() => {
  const parts = [
    "2. script-part.js",
    "3. script-part.js",
    "4. script-part.js",
    "5. script-part.js",
    "6. script-part.js",
    "7. script-part.js"
  ];

  Promise.all(parts.map(path => fetch(path).then(response => {
    if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
    return response.text();
  })))
    .then(sourceParts => {
      // Joining the parts recreates the original script byte-for-byte (apart from
      // the final newline handling), so the original closure/state/event behavior
      // is retained rather than refactored into separate modules.
      const source = sourceParts.join("");
      const run = new Function(`${source}\n//# sourceURL=1. script.bundle.js`);
      run();
    })
    .catch(error => {
      console.error("JavaScriptの分割ファイルを読み込めませんでした:", error);
    });
})();
