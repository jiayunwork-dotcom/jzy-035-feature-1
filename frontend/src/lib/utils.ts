/** 通用小工具 */

let counter = 0;

export function uid(prefix = 'c'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function readTextFile(): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        rejectPromise(new Error('未选择文件'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolvePromise(String(reader.result));
      reader.onerror = () => rejectPromise(reader.error ?? new Error('读取失败'));
      reader.readAsText(file);
    };
    input.click();
  });
}
