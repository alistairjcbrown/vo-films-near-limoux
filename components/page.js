const CssReset = require("./css-reset");

const Page = (...content) => {
  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VO films near Limoux</title>
  <link rel="stylesheet" href="css/styles.css?v=1.0">
  ${CssReset()}
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 16px; /* Base font size */
      line-height: 1.5;
      padding: 1rem 1rem 3rem 1rem;
    }

    h1, h2, h3, h4, h5, h6 {
      font-weight: bold;
    }

    p {
      margin-bottom: 1em;
    }

    hr {
      margin: 1rem 0;
    }

    .venue {
      border-bottom: 1px solid #ccc;
      padding: 2rem 0;
    }

    .venue h2 {
      align-items: center;
      display: flex;
      column-gap: 0.75rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }

    .venue h3 {
      margin-top: 1rem;
    }

    .venue-details {
      font-size: 1rem;
      font-weight: normal;
    }
  </style>
</head>
<body>
${content.join("\n")}
</body>
</html>
`;
};

module.exports = Page;
