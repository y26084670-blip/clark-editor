import { installViewportGate } from "./viewportGate.js";
import "./viewportGate.css";
import { installTrafficTracking } from "./services/trafficService.js";

installTrafficTracking("editor");

const root = document.getElementById("root");
const dispose = installViewportGate({
  root,
  applicationName: "E3D Editor",
  load: () => import("./startApp.jsx").then(({ startApp }) => () => startApp(root)),
});

if (import.meta.hot) import.meta.hot.dispose(dispose);
