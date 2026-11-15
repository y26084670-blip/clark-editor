// The existing material fixture supplies real Solid/Tabulator/file-service paths.
import "./guideMaterials.fixture.jsx";
import Chart from "chart.js/auto";
import { TabulatorFull } from "tabulator-tables";
import { selectionService } from "../../src/services/selectionService.js";

window.htsGraphs = {
    chart(kind) { return Chart.getChart(document.querySelector(`[data-hts-graph="${kind}"] canvas`)); },
    charts() { return Object.values(Chart.instances); },
    detail() { return TabulatorFull.findTable(".material-library-detail .tabulator")[0]; },
    async saved() {
        const input = await selectionService.loadedTaskHandle().getDirectoryHandle("input3XX");
        const dir = await input.getDirectoryHandle("xapLibHTS");
        const handle = await dir.getFileHandle("TaskA_HTS.txt");
        return JSON.parse(new TextDecoder().decode(await (await handle.getFile()).arrayBuffer()));
    },
};
