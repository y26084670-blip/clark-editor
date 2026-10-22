import { render } from "solid-js/web";
import App from "../../src/App.jsx";
import { selectionService } from "../../src/services/selectionService.js";

localStorage.setItem("e3d.generalInformation.openAtStartup", "false");
render(() => <App />, document.getElementById("root"));
window.headerFixture = {
  ready: true,
  setPath: value => selectionService.setLoadedTaskPath(value),
};
