import { create } from 'zustand';

/**
 * 「内置风险规则」二级页的开关、「定位到某条风险规则」的请求通道，以及命令测试框的内容。
 *
 * 二级页挂在「命令执行策略」下面（桌面是 Agent 分类里的子页，手机是命令策略分类里的子页），
 * 命令测试的结果、审批弹窗都会想把用户带进去并落到某一条规则上，而二级页与这些入口互不
 * 持有对方（甚至还没挂载：从审批弹窗点过去是先切到设置页）—— 所以走一个全局小通道：
 *   - `pageOpen`：二级页是否打开。主页面的入口行 `openPage()`，页内返回 `closePage()`。
 *   - 请求方 `focus(id)`：打开二级页并要求定位到某条规则；列表按 `nonce` 变化响应，处理完后
 *     `clear()`。`ruleId` 是"待处理"的请求：列表晚于请求挂载时，挂上来就能接着处理；处理
 *     完清掉，以后再进二级页不会重放旧的定位。
 *   - `testCommand`：命令测试框的内容也放在这里 —— 主页面在二级页打开期间是卸载的，放组件
 *     自己的 state 里，用户去二级页看一眼再回来，刚输入的命令就没了。二级页里点规则的示例
 *     `tryCommand(cmd)` 把示例填进测试框并回到主页面（测试框随内容变化自动重测）。
 * `nonce` 保证同一条规则被连续点两次也会再触发一次。
 */
interface RiskRuleFocusState {
  pageOpen: boolean;
  ruleId: string | null;
  nonce: number;
  testCommand: string;
  openPage: () => void;
  closePage: () => void;
  focus: (ruleId: string) => void;
  clear: () => void;
  setTestCommand: (command: string) => void;
  tryCommand: (command: string) => void;
}

export const useRiskRuleFocusStore = create<RiskRuleFocusState>((set) => ({
  pageOpen: false,
  ruleId: null,
  nonce: 0,
  testCommand: '',
  openPage: () => set({ pageOpen: true }),
  closePage: () => set({ pageOpen: false, ruleId: null }),
  focus: (ruleId) =>
    set((s) => ({ pageOpen: true, ruleId, nonce: s.nonce + 1 })),
  clear: () => set({ ruleId: null }),
  setTestCommand: (testCommand) => set({ testCommand }),
  tryCommand: (testCommand) =>
    set({ testCommand, pageOpen: false, ruleId: null }),
}));
