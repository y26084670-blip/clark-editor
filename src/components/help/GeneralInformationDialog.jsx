import { For, createEffect, onCleanup } from "solid-js";
import projectSelectionUrl from "../../assets/help/project-selection.png";
import taskSelectionUrl from "../../assets/help/task-selection.png";
import "./GeneralInformationDialog.css";

const units = [
  ["Линейные размеры", "мм"],
  ["Площади", "мм²"],
  ["Объёмы", "мм³"],
  ["Время", "сек"],
  ["Плотность тока", "А/мм²"],
  ["Намагниченность, напряжённость магнитного поля", "кА/м"],
  ["Индукция", "Т"],
  ["Удельная электропроводность", "МСм/м"],
  ["Потокосцепление", "мВб"],
  ["Силы", "Н"],
  ["Момент", "Н·м"],
];

export function GeneralInformationDialog(props) {
  let dialog;
  let closeButton;
  let content;

  createEffect(() => {
    if (!dialog) return;
    if (props.open) {
      if (!dialog.open) {
        dialog.showModal();
        content.scrollTop = 0;
        closeButton?.focus({ preventScroll: true });
      }
    } else if (dialog.open) {
      dialog.close();
    }
  });

  onCleanup(() => {
    if (dialog?.open) dialog.close();
  });

  return (
    <dialog
      ref={(el) => (dialog = el)}
      class="general-information-dialog"
      aria-labelledby="general-information-title"
      onClose={() => props.onClose?.()}
    >
      <header class="general-information-header">
        <h2 id="general-information-title">Общая информация</h2>
      </header>

      <div
        ref={(el) => (content = el)}
        class="general-information-content"
        role="region"
        aria-label="Содержание справки"
        tabindex="0"
      >
        <section aria-labelledby="general-information-installation">
          <h3 id="general-information-installation">1. Установка примеров</h3>
          <p>
            Для загрузки рассчитанных примеров на вкладке «Выбор задания» выберите каталог
            со значком облака ☁, затем проект и задание. До выбора локального диска уже
            доступны 3D-геометрия, иллюстрации PICT и документы DOCS.
          </p>
          <p>
            Нажмите <strong>«Загрузить»</strong>. В окне «Локальная загрузка выделенного облачного проекта»
            выберите диск, укажите «Локальный каталог с проектами», проект и имя задания.
            При совпадении имён примите предложенное имя или введите своё. Нажмите
            <strong> «Применить»</strong>, чтобы скопировать выбранное задание со всеми результатами.
            После загрузки в списке будет выделена локальная копия. Её можно открыть для редактирования
            или добавить в список расчёта по пункту 4.
          </p>
          <p>
            Для быстрого знакомства без обязательств и загрузки дополнительных
            файлов нажмите кнопку{" "}
            <span
              class="general-information-sample general-information-demo-sample"
              role="img"
              aria-label="Кнопка «Демо»"
            >
              Демо
            </span>{" "}
            для эмуляции загрузки с возможностью редактирования конкретной задачи,
            3D просмотра конструкции и общего ознакомления с интерфейсом.
          </p>
          <p>
            Для установки решателя на Windows x86-64 запустите самораспаковывающийся
            файл <code>ClarkInstaller.exe</code> и выберите корень
            внутреннего стационарного диска
            (по умолчанию <code>D:\</code>). Установщик создаст
            каталог <code>clark.app</code> и четыре ярлыка в папке
            «Clark» на рабочем столе. Для запуска решателя следует кинуть
            подготовленный список на ярлык «Запуск расчета» в папке Clark.
            Но более удобно запустить ярлык обычным способом (двойным щелчком).
            При этом откроется стандартный диалог выбора нужного файла
            со списком заданий.
            <br />
            Полная функциональность редактора гарантируется для браузеров
            Google Chrome или Microsoft Edge.
          </p>
          <p>
            В файле <code>clark.app\config\runtime.json</code> задайте
            параметр <code>mpiRanks</code> равным числу физических ядер компьютера.
            {" При установке по умолчанию задано 4 параллельных процесса."}
          </p>
        </section>

        <section aria-labelledby="general-information-selection">
          <h3 id="general-information-selection">2. Выбор и предпросмотр</h3>
          <p>
            Для работы с локальными заданиями откройте панель <strong>«Доступ к проектам»</strong>
            и выберите диск с правами чтения и записи. Там же можно нажать
            <strong> «Связать с Решателем»</strong> и один раз подтвердить тот же диск
            в Clark. Затем нажмите <strong>«Продолжить»</strong> и выберите в верхнем
            списке каталог <strong>clark.*</strong>, обычно <strong>clark.projects</strong>.
            Каталог clark.app исключён. Кнопка «Доступ к проектам» позволяет снова выбрать диск.
          </p>
          <p>
            Редактор использует двухуровневую систему каталогов:
            <strong> проекты → задания</strong>. Так организованы и примеры.
          </p>
          <table class="general-information-selection-table">
            <thead>
              <tr>
                <th scope="col">сначала выберите проект</th>
                <th scope="col">затем выберите задание</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <img
                    class="general-information-project-image"
                    src={projectSelectionUrl}
                    alt="Выбор проекта в списке проектов"
                    width="289"
                    height="147"
                    draggable={false}
                  />
                </td>
                <td>
                  <img
                    class="general-information-task-image"
                    src={taskSelectionUrl}
                    alt="Выбор задания в списке заданий выбранного проекта"
                    width="292"
                    height="147"
                    draggable={false}
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <ul>
            <li>
              Выбор задания щелчком в списке показывает его
              {" "}
              исходную 3D-геометрию, без симметричных образов.
            </li>
            <li>
              <span
                class="task-load-button general-information-sample general-information-load-sample"
                role="img"
                aria-label="Кнопка «Загрузить для редактирования»"
              >
                Загрузить для редактирования
              </span>
              {" открывает задание "}
              для изменения данных. Если в уже загруженном задании есть
              несохранённые изменения, появится предупреждение с вариантами
              дальнейших действий.
            </li>
          </ul>
        </section>

        <section aria-labelledby="general-information-interface">
          <h3 id="general-information-interface">3. Помощь при работе с интерфейсом</h3>
          <p>
            Справка по параметрам колонки находится во всплывающей подсказке
            её заголовка. Подсказки также предусмотрены у других элементов
            интерфейса, когда требуется пояснение.
          </p>
          <p>
            Геометрию загруженного задания с показом симметрий, дискретизации
            и других деталей можно посмотреть в плавающем окне при нажатии
            кнопки 3D{" "}
            <span
              class="geometry-button general-information-sample general-information-geometry-sample"
              role="img"
              aria-label="Кнопка «3D»"
            >
              3D
            </span>
            .
          </p>
          <p>
            Кнопка <strong>«Дополнительные функции»</strong>{" "}
            <span
              class="menu-button general-information-sample general-information-menu-sample"
              role="img"
              aria-label="Значок кнопки «Дополнительные функции»"
            >
              ☰
            </span>
            {" открывает "}
            выдвижное меню слева. В нём доступны:
          </p>
          <ul>
            <li>
              На вкладке «Выбор задания» сворачиваемый раздел <strong>«Работа с проектами»</strong>:
              <strong> «Создать проект»</strong>, <strong>«Переименовать проект»</strong>, <strong>«Удалить пустой проект»</strong>.
              В разделе <strong>«AI запросы»</strong> команда <strong>«Геометрия по эскизу»</strong> открывает окно <strong>«ZIP по эскизу для ИИ»</strong>.
              В разделе <strong>«Работа с заданиями»</strong>:
              <strong> «Создать задание»</strong>, <strong>«Создать копию»</strong>, <strong>«Переименовать задание»</strong>,
              <strong> «Перенести в другой каталог»</strong>, <strong>«Удалить задание»</strong>.
            </li>
            <li>
              <strong>«История текущей вкладки»</strong> — отмена и повтор
              изменений (undo/redo), отдельно для каждой вкладки.
            </li>
            <li>
              <strong>Действия текущей вкладки.</strong> На вкладке
              «Элементы» можно назначать характеристики элементам,
              выделенным в списке.
            </li>
          </ul>
          <p>
            На вкладках <strong>«Импульсы»</strong> и
            <strong> «Траектории»</strong> встроены генераторы временных
            зависимостей по аналитическим формулам с просмотром графиков.
            Набор формул можно редактировать и сохранять в задании в простом
            текстовом файле для последующего использования.
          </p>
        </section>

        <section aria-labelledby="general-information-quick-start">
          <h3 id="general-information-quick-start">
            4. Быстрая справка по установке и использованию решателя.
          </h3>
          <ul>
            <li>Установите Clark с помощью <code>ClarkInstaller.exe</code> и свяжите
              локальный диск с решателем через «Доступ к проектам».</li>
            <li>В Editor нажмите зелёную кнопку «Формирование списка заданий и запуск приложений».
              Перетащите нужное локальное задание из списка проекта в открывшееся окно.</li>
            <li>Если Windows отметила файлы задания как заблокированные, его имя подсвечивается красным.
              Для проверки обновите список заданий. В окне запуска выберите
              «разблокировать» и нажмите «Запустить». Команда применяется к заданиям списка.</li>
            <li>Для расчёта выберите режим «расчёт» и нажмите «Запустить».
              Список также можно передать ярлыку «Запуск расчета» в папке Clark на рабочем столе.</li>
          </ul>
        </section>

        <section aria-labelledby="general-information-units">
          <h3 id="general-information-units">5. Используемые размерности</h3>
          <table class="general-information-units">
            <thead>
              <tr>
                <th scope="col">Величина</th>
                <th scope="col">Единица</th>
              </tr>
            </thead>
            <tbody>
              <For each={units}>
                {([quantity, unit]) => (
                  <tr>
                    <th scope="row">{quantity}</th>
                    <td>{unit}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </section>
      </div>

      <footer class="general-information-footer">
        <label class="general-information-startup-option">
          <input
            type="checkbox"
            checked={props.openAtStartup}
            onChange={(event) => props.onOpenAtStartupChange?.(event.currentTarget.checked)}
          />
          <span>Открывать эту панель при старте</span>
        </label>
        <button
          ref={(el) => (closeButton = el)}
          type="button"
          class="general-information-close-button"
          onClick={() => {
            dialog.close();
          }}
        >
          Закрыть
        </button>
      </footer>
    </dialog>
  );
}
