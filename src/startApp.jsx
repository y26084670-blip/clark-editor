/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App.jsx";

export function startApp(root) {
  return render(() => <App />, root);
}
