import { For, Show, batch, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { formatIterationValue, iterationTaskKey, parseIterationValue,
  matrixIndexNames, readIterationStatus, sendIterationRequest } from "../../services/iterationControlService.js";

const initialAddress = () => Object.fromEntries(matrixIndexNames.map(name => [name, "1"]));
const matrixHint = "В 3D включите «Общие опции → Центры и узлы» и наведите указатель на центр ЭО. Если номер образа не показан, используйте 1. Для AS и PS по полю доступен только исходный образ.";

export function IterationControl(props) {
  const [status, setStatus] = createSignal(null);
  const [tau, setTau] = createSignal("0.0000"), [eps, setEps] = createSignal("0.0000000000");
  const [useTau, setUseTau] = createSignal(false), [useEps, setUseEps] = createSignal(false);
  const [useMResidual, setUseMResidual] = createSignal(false), [useJResidual, setUseJResidual] = createSignal(false);
  const [useMatrix, setUseMatrix] = createSignal(false), [address, setAddress] = createSignal(initialAddress());
  const [sending, setSending] = createSignal(false), [pending, setPending] = createSignal(null);
  const [error, setError] = createSignal(""), [notice, setNotice] = createSignal("");
  let revision = 0, polling = false, disposed = false;
  const enabled = () => Boolean(status()) && !sending() && !pending();
  function reset() {
    batch(() => { setStatus(null); setTau("0.0000"); setEps("0.0000000000");
      setUseTau(false); setUseEps(false); setUseMResidual(false); setUseJResidual(false);
      setUseMatrix(false);
      setPending(null); setError(""); setNotice(""); });
  }
  async function poll() {
    const root = props.rootHandle, binding = props.binding, version = revision;
    if (disposed || polling || !props.active || !root) return;
    polling = true;
    try {
      const next = await readIterationStatus(root, binding);
      if (disposed || revision !== version) return;
      const changed = iterationTaskKey(next) !== iterationTaskKey(status());
      if (!next) { reset(); return; }
      batch(() => {
        if (changed) { setUseTau(false); setUseEps(false); setUseMResidual(false); setUseJResidual(false);
          setUseMatrix(false); setAddress(initialAddress());
          setPending(null); setError(""); setNotice(""); }
        setStatus(next);
        if (!useTau()) setTau(formatIterationValue(next.tau, "TAU"));
        if (!useEps()) setEps(formatIterationValue(next.eps, "EPS"));
        if (pending() && next.request?.requestId === pending()
          && ["applied", "rejected"].includes(next.request.state)) {
          setPending(null);
          if (next.request.state === "applied") setNotice(`Запрос выполнен: итерация ${next.request.iteration}.`);
          else { setNotice(""); setError(next.request.message || "Запрос отклонён."); }
        }
      });
    } catch {
      if (!disposed && revision === version) reset();
    } finally { polling = false; }
  }
  createEffect(() => {
    props.rootHandle; props.binding; props.active;
    revision++; reset(); void poll();
  });
  onMount(() => { const timer = setInterval(poll, 500); onCleanup(() => clearInterval(timer)); });
  onCleanup(() => { disposed = true; revision++; });
  function normalize(parameter) {
    const selected = parameter === "TAU" ? tau : eps;
    const update = parameter === "TAU" ? setTau : setEps;
    try { update(formatIterationValue(parseIterationValue(selected(), parameter), parameter)); setError(""); }
    catch (failure) { setError(failure.message); }
  }
  async function submit() {
    if (!enabled()) return;
    const root = props.rootHandle, binding = props.binding, version = revision, task = status();
    setSending(true); setError(""); setNotice("");
    try {
      const values = { ...(useTau() ? { TAU: tau() } : {}), ...(useEps() ? { EPS: eps() } : {}),
        ...(useMResidual() ? { MResidual: true } : {}), ...(useJResidual() ? { JResidual: true } : {}),
        ...(useMatrix() ? { MatrixBlock: address() } : {}) };
      const id = await sendIterationRequest(root, binding, task, values);
      if (disposed || revision !== version || iterationTaskKey(status()) !== iterationTaskKey(task)) return;
      batch(() => { setPending(id); setUseTau(false); setUseEps(false); setUseMResidual(false); setUseJResidual(false);
        setUseMatrix(false);
        setNotice("Запрос передан. Ожидание границы итерации…"); });
    } catch (failure) { if (!disposed && revision === version) setError(failure.message); }
    finally { if (!disposed) setSending(false); }
  }
  return <>
    <button type="button" class="iteration-control-submit" disabled={!enabled()} onClick={submit}
      title={status() ? `Активное задание: ${status().taskPath}. Применить выбранные параметры в конце итерации.` : "Нет активного задания с поддержкой общей памяти"}>
      <span>Активная задача.</span><span>Установить значения</span><span>параметров справа</span>
    </button>
    <div class="iteration-control-options">
      <div class="iteration-group-title">параметры итерационного процесса</div>
      <div class="iteration-control-fields" aria-label="Параметры активного задания">
        <input type="checkbox" aria-label="Изменить TAU" checked={useTau()} disabled={!enabled()}
          onChange={event => setUseTau(event.currentTarget.checked)} />
        <label>TAU <input type="text" inputMode="decimal" aria-label="Новое значение TAU" value={tau()}
          disabled={!enabled() || !useTau()} onInput={event => setTau(event.currentTarget.value)} onBlur={() => normalize("TAU")} /></label>
        <input type="checkbox" aria-label="Изменить EPS" checked={useEps()} disabled={!enabled()}
          onChange={event => setUseEps(event.currentTarget.checked)} />
        <label>EPS <input type="text" inputMode="decimal" aria-label="Новое значение EPS" value={eps()}
          disabled={!enabled() || !useEps()} onInput={event => setEps(event.currentTarget.value)} onBlur={() => normalize("EPS")} /></label>
      </div>
      <div class="iteration-group-title">визуализировать невязку итерации</div>
      <div class="iteration-control-residuals" aria-label="Запись невязок активного задания">
        <label><input type="checkbox" checked={useMResidual()} disabled={!enabled()}
          onChange={event => setUseMResidual(event.currentTarget.checked)} /> M-невязка</label>
        <label><input type="checkbox" checked={useJResidual()} disabled={!enabled()}
          onChange={event => setUseJResidual(event.currentTarget.checked)} /> J-невязка</label>
      </div>
      <div class="iteration-group-title" title={matrixHint}>матричные элементы</div>
      <div class="iteration-control-matrix" title={matrixHint}>
        <label title={status() && !status().matrixBlockSupported ? matrixHint + " Требуется обновлённый Solver и его программа запуска." : matrixHint}>
          <input type="checkbox" checked={useMatrix()} disabled={!enabled() || status()?.matrixBlockSupported !== true}
            onChange={event => setUseMatrix(event.currentTarget.checked)} />Элемент</label>
        <For each={matrixIndexNames}>{key => <label>{key === "element" ? "№" : key.toUpperCase()}
          <input type="text" inputMode="numeric" aria-label={key === "element" ? "Номер элемента" : key.toUpperCase()}
            value={address()[key]} disabled={!enabled() || !useMatrix() || status()?.matrixBlockSupported !== true}
            onInput={event => setAddress({ ...address(), [key]: event.currentTarget.value })} /></label>}</For>
      </div>
    </div>
    <Show when={error()}><div class="iteration-control-message task-launch-error" role="alert">{error()}</div></Show>
    <Show when={notice()}><div class="iteration-control-message task-launch-notice" role="status">{notice()}</div></Show>
  </>;
}
