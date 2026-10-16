import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const script = String.raw`
function run(argv) {
  const input = JSON.parse(argv[0]);
  const app = Application('Calendar');
  const calendars = app.calendars.whose({name: '开图'})();
  let calendar = calendars[0];
  if (!calendar) {
    if (input.uid || input.action === 'remove') return JSON.stringify({uid: null});
    calendar = app.Calendar({name: '开图'});
    app.calendars.push(calendar);
  }
  const marker = '开图记录：' + input.entry.id;
  let events = input.uid ? calendar.events.whose({uid: input.uid})() :
    calendar.events.whose({description: {_contains: marker}})();
  let event = input.uid ? events[0] : events.find(function(item) {
    return item.description().split('\n').some(function(line) {
      return line === marker || line.indexOf(marker + '（') === 0;
    });
  });
  if (input.action === 'remove') {
    if (event) app.delete(event);
    return JSON.stringify({uid: null});
  }
  if (!event && input.uid) return JSON.stringify({uid: null});
  if (!event) {
    event = app.Event({summary: input.entry.title, startDate: new Date(input.entry.start),
      endDate: new Date(input.entry.end), description: input.entry.notes});
    calendar.events.push(event);
    event.displayAlarms.push(app.DisplayAlarm({triggerInterval: -10}));
  } else if (input.changed !== false) {
    event.summary = input.entry.title;
    event.startDate = new Date(input.entry.start);
    event.endDate = new Date(input.entry.end);
    event.description = input.entry.notes;
  }
  return JSON.stringify({uid: event.uid()});
}
`;

export function createCalendarExecutor() {
  const run = async (input) => {
    try {
      const { stdout } = await execute(
        "/usr/bin/osascript",
        ["-l", "JavaScript", "-e", script, JSON.stringify(input)],
        { timeout: 60000, maxBuffer: 1024 * 1024 },
      );
      return JSON.parse(stdout).uid;
    } catch (error) {
      const denied = /-1743|not authorized|不允许|无权/.test(String(error.stderr ?? error.message));
      throw new Error(
        denied
          ? "未获日历自动化授权。可在系统设置 → 隐私与安全性 → 自动化中允许开图控制日历，再重试"
          : "日历写入失败。请检查日历 App；也可在系统设置 → 隐私与安全性 → 自动化中允许开图控制日历，再重试",
      );
    }
  };
  return {
    upsert: (entry, uid, changed) => run({ action: "upsert", entry, uid, changed }),
    remove: (uid, entry) => run({ action: "remove", uid, entry }),
  };
}
