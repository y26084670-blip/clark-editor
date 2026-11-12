import { installTrafficTracking } from "../services/trafficService.js";
import { analyzeMed } from "../services/medAnalysisService.js";

installTrafficTracking("editor");
self.onmessage = ({data}) => {
    try { self.postMessage({result:analyzeMed(data)}); }
    catch(error) { self.postMessage({error:error instanceof Error?error.message:String(error)}); }
};
