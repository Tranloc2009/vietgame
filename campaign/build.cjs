const fs = require("node:fs"),
  path = require("node:path");
const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");
const image = fs
  .readFileSync(path.join(__dirname, "assets/relief.webp"))
  .toString("base64");
const html = read("index.html")
  .replace(
    '<link rel="stylesheet" href="style.css">',
    () => "<style>" + read("style.css") + "</style>",
  )
  .replace(/<script src="([^"]+)"><\/script>/g, (_, file) => {
    const js = read(file).replace(/(['"])assets\/relief\.webp\1/, () =>
      JSON.stringify("data:image/webp;base64," + image),
    );
    return "<script>" + js.replace(/<\/script/gi, "<\\/script") + "</script>";
  });
fs.writeFileSync(path.resolve(__dirname, "../index.html"), html);
