import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { SkillResource } from '@/lib/types';
import {
  byteLength,
  normalizeResourcePath,
  validateResourceBudget,
  validateResourcePath,
} from '@/lib/skillResources';

interface Props {
  resources: SkillResource[];
  onChange: (next: SkillResource[]) => void;
  /** 内置 skill 等只读场景：仅展示内容，不可增删改 */
  readOnly?: boolean;
  /** 触屏尺寸（手机端）：更大的点击区域 */
  touch?: boolean;
}

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

/**
 * skill 附属资源（.md）编辑器：展开查看 / 改内容 / 改路径 / 删除 / 新增。
 * 桌面编辑弹窗、新建弹窗与手机编辑 sheet 共用，行为只此一份。
 */
export default function SkillResourcesEditor({
  resources,
  onChange,
  readOnly = false,
  touch = false,
}: Props) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [newPath, setNewPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (readOnly && resources.length === 0) return null;

  const pad = touch ? 'px-3 py-3' : 'px-3 py-1.5';
  const inputCls =
    'w-full rounded-lg bg-zinc-900 border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-100 ' +
    'font-mono placeholder-zinc-500 focus:outline-none focus:border-indigo-500' +
    (touch ? ' py-2.5 text-sm' : '');

  const apply = (next: SkillResource[]) => {
    const budget = validateResourceBudget(next);
    if (budget) {
      setError(budget);
      return;
    }
    setError(null);
    onChange(next);
  };

  const handleAdd = () => {
    const path = normalizeResourcePath(newPath);
    const err = validateResourcePath(path, resources);
    if (err) {
      setError(err);
      return;
    }
    apply([...resources, { path, content: '' }]);
    setNewPath('');
    setOpenPath(path);
  };

  const handleRename = (index: number, raw: string) => {
    const path = normalizeResourcePath(raw);
    if (path === resources[index].path) return;
    const err = validateResourcePath(path, resources, index);
    if (err) {
      setError(err);
      return;
    }
    if (openPath === resources[index].path) setOpenPath(path);
    apply(resources.map((r, i) => (i === index ? { ...r, path } : r)));
  };

  return (
    <div>
      <label className='block text-xs text-zinc-400 mb-1'>附属资源文件（{resources.length}）</label>

      {resources.length > 0 && (
        <ul className='rounded-lg bg-zinc-900 border border-zinc-800 divide-y divide-zinc-800'>
          {resources.map((r, i) => {
            const open = openPath === r.path;
            return (
              <li key={r.path}>
                <div className={`flex items-center gap-2 ${pad}`}>
                  <button
                    type='button'
                    onClick={() => setOpenPath(open ? null : r.path)}
                    className='flex min-w-0 flex-1 items-center gap-1.5 text-left'
                  >
                    {open ? (
                      <ChevronDown className='h-3.5 w-3.5 shrink-0 text-zinc-500' />
                    ) : (
                      <ChevronRight className='h-3.5 w-3.5 shrink-0 text-zinc-500' />
                    )}
                    <span className='truncate font-mono text-[11px] text-zinc-300'>{r.path}</span>
                    <span className='shrink-0 text-[10px] text-zinc-600'>
                      {fmtSize(byteLength(r.content))}
                    </span>
                  </button>
                  {!readOnly && (
                    <button
                      type='button'
                      aria-label={`删除 ${r.path}`}
                      onClick={() => {
                        setError(null);
                        if (open) setOpenPath(null);
                        onChange(resources.filter((_, j) => j !== i));
                      }}
                      className='shrink-0 rounded p-1 text-zinc-500 hover:text-red-400 active:text-red-400'
                    >
                      <Trash2 className={touch ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
                    </button>
                  )}
                </div>
                {open && (
                  <div className='space-y-2 px-3 pb-3'>
                    {!readOnly && (
                      <input
                        key={r.path}
                        type='text'
                        defaultValue={r.path}
                        onBlur={(e) => handleRename(i, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        spellCheck={false}
                        autoCapitalize='off'
                        autoCorrect='off'
                        className={inputCls}
                      />
                    )}
                    <textarea
                      value={r.content}
                      readOnly={readOnly}
                      onChange={(e) =>
                        apply(resources.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))
                      }
                      spellCheck={false}
                      autoCapitalize='off'
                      autoCorrect='off'
                      rows={touch ? 8 : 10}
                      className={inputCls + ' min-h-32 resize-y leading-relaxed'}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <div className='mt-2 flex gap-2'>
          <input
            type='text'
            value={newPath}
            onChange={(e) => {
              setNewPath(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder='新增资源路径，如 references/api.md'
            spellCheck={false}
            autoCapitalize='off'
            autoCorrect='off'
            className={inputCls}
          />
          <button
            type='button'
            onClick={handleAdd}
            disabled={!newPath.trim()}
            className='flex shrink-0 items-center gap-1 rounded-lg bg-zinc-700 px-3 text-xs text-zinc-100 hover:bg-zinc-600 active:bg-zinc-600 disabled:opacity-40'
          >
            <Plus className='h-3.5 w-3.5' />
            添加
          </button>
        </div>
      )}

      {error && <p className='mt-1 text-[11px] text-red-400'>{error}</p>}
      <p className='mt-1 text-[11px] text-zinc-500'>
        Agent 可在需要时按路径读取这些文档；在指令里写明各文件的用途它才知道何时去读。
      </p>
    </div>
  );
}
