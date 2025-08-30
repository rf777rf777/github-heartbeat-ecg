import { NodeECGRenderer } from "./src/chart.js";

const renderer = new NodeECGRenderer();
renderer.setDatasets([
  { username: "UserA", data: [1, 2, 3, 2, 1] },
  { username: "UserB", data: [0.5, 0.8, 1.2] }
]);

await renderer.generateGIF("./images/ecg-test.gif", { seconds: 60 });
console.log("GIF generated: ecg-test.gif");
