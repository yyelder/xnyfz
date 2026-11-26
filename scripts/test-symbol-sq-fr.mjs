/**
 * 按钮 SB / 行程开关 SQ / 热继电器 FR 符号专项验证
 * ------------------------------------------------------------------
 * 对齐《电力拖动控制线路与技能训练》附录的国标图形符号：
 * 1. 按钮：左侧 E 形推杆 + 虚线联动，斜刀触点，常闭带短路片
 * 2. 行程开关：斜刀刃身挂撞块小三角，复合型两组撞块虚线联动
 * 3. 热继电器：一个整体宽框 + 三组阶梯双金属片；常闭斜刀右倾落在短路片内、常开左倾，右侧标记统一「⊏」开口朝外
 * 4. 引脚/标号：热元件包围盒覆盖整个框体，标号不压符号
 * 5. 辅助触点 KM/KA/KT 瞬动：常开斜刀，常闭「短路片 + 斜穿」
 * 6. 接触器主触头：静触头下端小方钩
 * 7. 空气开关：静触头「×」+ 斜刀 + 极间点线
 * 8. 插座：单相两眼 / 单相三眼 / 三相插座
 */
import fs from 'node:fs';
import { drawSymbol } from '../shared/render/symbols.js';
import { typeBounds } from '../shared/render/layout.js';
import { SimulationEngine } from '../shared/engine/index.js';

const pack = JSON.parse(fs.readFileSync(new URL('../resources/packs/device-types.json', import.meta.url), 'utf8'));
const deviceTypes = pack.types;
const T = (id) => deviceTypes.find((t) => t.id === id) || { id, symbol: id, pins: [] };

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (ok) pass += 1;
  else fail += 1;
};

const attr = (svg, name) => (svg.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
const contact = (svg, i = 0) => (svg.match(/<g class="blade-contact"[^>]*>/g) || [])[i] || '';
const actuator = (svg) => (svg.match(/<g class="button-actuator"[^>]*>/) || [])[0] || '';
const aux = (svg, i = 0) => (svg.match(/<g class="aux-contact"[^>]*>/g) || [])[i] || '';
const pole = (svg, i = 0) => (svg.match(/<g class="breaker-pole"[^>]*>/g) || [])[i] || '';

/* ---------------------------------------------------------- 1. 按钮 */
console.log('\n[1] 按钮 SB（E 形推杆 + 斜刀）');
{
  const open = drawSymbol(T('sb_no'), { closed: false, pressed: false });
  const press = drawSymbol(T('sb_no'), { closed: true, pressed: true });
  check('常开·常态：斜刀朝左倾倒 28°', attr(contact(open), 'data-angle') === '-28', attr(contact(open), 'data-angle'));
  check('常开·常态：静触点无短路片', !open.includes('class="contact-bar"'));
  check('常开·常态：有 E 形推杆', open.includes('class="button-actuator"') && attr(actuator(open), 'data-pressed') === '0');
  check('常开·常态：E 竖杆在触点左侧 30px', attr(actuator(open), 'data-x') === '-30', attr(actuator(open), 'data-x'));
  check('常开·常态：虚线推杆接到刀身', open.includes('class="link-rod"'), attr(open, 'data-end'));
  check('按钮：铰点向下补短竖线接到下接线引脚 y=28', /x1="0" y1="11" x2="0" y2="28"/.test(open));
  const endX = Number(attr(open, 'data-end'));
  check('常开·常态：虚线终点＝斜刀与 y=0 的交点', Math.abs(endX - -5.85) < 0.05, String(endX));
  check('常开·按下：斜刀回正到 0°', attr(contact(press), 'data-angle') === '0');
  check('常开·按下：整只推杆右移 4px', attr(actuator(press), 'data-x') === '-26', attr(actuator(press), 'data-x'));

  const nc = drawSymbol(T('sb_nc'), { closed: true, pressed: false });
  const ncOpen = drawSymbol(T('sb_nc'), { closed: false, pressed: true });
  check('常闭·常态：斜刀压住短路片（+28°）', attr(contact(nc), 'data-angle') === '28' && nc.includes('class="contact-bar"'));
  check('常闭·常态：短路片朝右，刀尖落在片端', /x1="0" y1="-7.54" x2="9.86" y2="-7.54"/.test(nc), 'bar');
  check('常闭·按下：斜刀离开短路片（-17.36°）', Math.abs(Number(attr(contact(ncOpen), 'data-angle')) - -17.36) < 0.05, attr(contact(ncOpen), 'data-angle'));

  const comp = drawSymbol(T('sb_comp'), { closed: false, pressed: false });
  const contacts = comp.match(/<g class="blade-contact"[^>]*>/g) || [];
  check('复合按钮：两组触点', contacts.length === 2);
  check('复合按钮：左组为常闭并镜像到左侧', attr(contacts[0], 'data-nc') === '1' && attr(contacts[0], 'data-mirror') === '1');
  check('复合按钮：右组为常开', attr(contacts[1], 'data-nc') === '0' && attr(contacts[1], 'data-x') === '22');
  check('复合按钮：共用一只推杆', (comp.match(/class="button-actuator"/g) || []).length === 1);
  check('复合按钮：推杆虚线穿过两组刀身', Number(attr(comp, 'data-end')) > 16, attr(comp, 'data-end'));
  check('复合按钮：两组下引线分别接到各自引脚', /x1="-22" y1="11" x2="-22" y2="28"/.test(comp) && /x1="22" y1="11" x2="22" y2="28"/.test(comp));
}

/* ---------------------------------------------------------- 2. 行程开关 */
console.log('\n[2] 行程开关 SQ（撞块三角挂在刀身上）');
{
  const no = drawSymbol(T('sq_no'), { closed: false });
  const noOn = drawSymbol(T('sq_no'), { closed: true });
  check('常开·常态：斜刀朝左倾倒', attr(contact(no), 'data-angle') === '-28');
  check('常开·常态：刀身中段挂撞块三角', no.includes('class="limit-actuator"'));
  const apex = (attr(contact(no), 'data-apex') || '').split(',').map(Number);
  const tip = (attr(contact(no), 'data-tip') || '').split(',').map(Number);
  check('常开·常态：三角尖点在刀身左侧、刀尖下方', apex[0] < tip[0] && apex[1] > tip[1], `apex=${apex} tip=${tip}`);
  check('常开·常态：触点无短路片', !no.includes('class="contact-bar"'));
  check('行程开关：铰点向下补短竖线接到下接线引脚 y=28', /x1="0" y1="11" x2="0" y2="28"/.test(no));
  check('常开·压下：斜刀回正到 0°', attr(contact(noOn), 'data-angle') === '0');

  const nc = drawSymbol(T('sq_nc'), { closed: true });
  check('常闭·常态：斜刀朝右压住短路片', attr(contact(nc), 'data-angle') === '28' && nc.includes('class="contact-bar"'));
  check('常闭·常态：撞块三角在刀身左侧', no.includes('class="limit-actuator"'));

  const comp = drawSymbol(T('sq_comp'), { closed: false, state: 'open' });
  const contacts = comp.match(/<g class="blade-contact"[^>]*>/g) || [];
  check('复合行程开关：两组触点', contacts.length === 2);
  check('复合行程开关：左常闭镜像、右常开', attr(contacts[0], 'data-mirror') === '1' && attr(contacts[1], 'data-nc') === '0');
  check('复合行程开关：两组都有撞块', (comp.match(/class="limit-actuator"/g) || []).length === 2);
  check('复合行程开关：两组下引线分别接到各自引脚', /x1="-22" y1="11" x2="-22" y2="28"/.test(comp) && /x1="22" y1="11" x2="22" y2="28"/.test(comp));
  check('复合行程开关：虚线把两组撞块连起来', /stroke-dasharray="3 2.4"/.test(comp));
  const link = (comp.match(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)"[^>]*stroke-dasharray="3 2.4"/) || []).map(Number);
  check('复合行程开关：虚线两端水平（同一高度）', link[2] === link[4], `${link[2]} / ${link[4]}`);
  const a1 = (attr(contacts[0], 'data-apex') || '').split(',').map(Number);
  const a2 = (attr(contacts[1], 'data-apex') || '').split(',').map(Number);
  check('复合行程开关：虚线起点＝左撞块尖点', Math.abs(link[1] - a1[0]) < 0.05, `${link[1]} vs ${a1[0]}`);
  check('复合行程开关：虚线终点＝右撞块尖点', Math.abs(link[3] - a2[0]) < 0.05, `${link[3]} vs ${a2[0]}`);
}

/* ---------------------------------------------------------- 3. 热继电器 */
console.log('\n[3] 热继电器 FR');
{
  const main = drawSymbol(T('fr_main'), {});
  check('热元件：只有一个整体框', (main.match(/<rect /g) || []).length === 1);
  check('热元件：框体 224×46，覆盖三个极', main.includes('x="-112" y="-23" width="224" height="46"'));
  check('热元件：框内三段双金属片阶梯', (main.match(/class="bimetal"/g) || []).length === 3);
  check('热元件：阶梯分别落在 -80 / 0 / 80', ['-80', '0', '80'].every((x) => main.includes(`class="bimetal" data-x="${x}"`)));
  check('热元件：不再画三个独立小框', !main.includes('stroke-dasharray="4 3"'));
  const step = (main.match(/class="bimetal" data-x="-80"[^>]*d="([^"]*)"/) || [])[1] || '';
  check('热元件：导体自引脚进入框体、向左折一级后回正',
    step.startsWith('M -80 -30') && step.includes('L -100 -12') && step.includes('L -100 12') && step.endsWith('L -80 30'), step);

  const fr = (svg) => (svg.match(/<g class="blade-contact fr-contact"[^>]*>/) || [])[0] || '';
  const linkX1 = (svg) => {
    const line = (svg.match(/<line[^>]*class="thermal-link"[^>]*>/) || [])[0] || '';
    return Number((line.match(/x1="([^"]*)"/) || [])[1]);
  };
  const nc = drawSymbol(T('fr_nc'), { closed: true });
  const ncOpen = drawSymbol(T('fr_nc'), { closed: false });
  check('常闭触点：静触头末端带短路片', nc.includes('class="contact-bar"'));
  check('常闭触点：短路片长 12', attr(fr(nc), 'data-bar') === '12', attr(fr(nc), 'data-bar'));
  check('常闭触点：闭合时斜刀向右倒 21°', attr(fr(nc), 'data-angle') === '21', attr(fr(nc), 'data-angle'));
  const ncTip = (attr(fr(nc), 'data-tip') || '').split(',').map(Number);
  check('常闭触点：刀尖落在短路片端以内、左侧无悬空断口', ncTip[0] > 0 && ncTip[0] < 12 && ncTip[1] < -9, `${ncTip}`);
  check('常闭触点：右侧「⊏」标记开口朝外', nc.includes('data-side="right" data-open="right"'));
  const ncLink = (nc.match(/<line[^>]*class="thermal-link"[^>]*>/) || [])[0] || '';
  check('常闭触点：虚线自刀身左侧 12 起、横穿到标记', linkX1(nc) > -10 && linkX1(nc) < -6 && ncLink.includes('x2="24"') && ncLink.includes('stroke-dasharray'), ncLink.slice(0, 70));
  check('常闭触点：断开时斜刀反向倒向左侧 21°、与短路片脱开', attr(fr(ncOpen), 'data-angle') === '-21', attr(fr(ncOpen), 'data-angle'));
  const trippedNc = drawSymbol(T('fr_nc'), { closed: false, tripped: true });
  check('常闭触点：脱扣后断开并变红', attr(fr(trippedNc), 'data-angle') === '-21' && trippedNc.includes('#d63a3a'));

  const no = drawSymbol(T('fr_no'), { closed: false });
  check('常开触点：常态断开（斜刀 -21°）', attr(fr(no), 'data-angle') === '-21', attr(fr(no), 'data-angle'));
  check('常开触点：标记在右侧、开口朝外', no.includes('data-side="right" data-open="right"'));
  check('常开/常闭标记方向一致（都朝右）', nc.includes('data-open="right"') && no.includes('data-open="right"'));
  const noTip = (attr(fr(no), 'data-tip') || '').split(',').map(Number);
  check('常开触点：刀尖停在上引线左侧、留出间隙', noTip[0] < -6 && noTip[1] <= -10, `${noTip}`);
  check('常开触点：无短路片', !no.includes('class="contact-bar"'));
  const noLink = (no.match(/<line[^>]*class="thermal-link"[^>]*>/) || [])[0] || '';
  check('常开触点：虚线自刀身左侧 12 起、止于标记竖片', linkX1(no) > -18 && linkX1(no) < -14 && noLink.includes('x2="24"'), noLink.slice(0, 70));
  const trippedNo = drawSymbol(T('fr_no'), { closed: true, tripped: true });
  check('常开触点：脱扣后闭合（报警）', attr(fr(trippedNo), 'data-angle') === '0', attr(fr(trippedNo), 'data-angle'));
  check('常开触点：脱扣后闭合导通、常态不导通', (() => {
    const mk = () => new SimulationEngine({
      deviceTypes,
      circuit: {
        supply: { system: '1ph', voltage: 220 },
        devices: [
          { id: 'SB', type: 'sb_no', label: 'SB', props: {} },
          { id: 'fr', type: 'fr_no', label: 'FR', props: {} },
          { id: 'lamp', type: 'el_lamp', label: 'HL', props: {} },
        ],
        nets: [
          { id: 'L', phase: 'L', pins: [['SB', '1']] },
          { id: 'nB', pins: [['SB', '2'], ['fr', '1']] },
          { id: 'nC', pins: [['fr', '2'], ['lamp', '1']] },
          { id: 'N', phase: 'N', pins: [['lamp', '2']] },
        ],
      },
    });
    const e = mk();
    e.press('SB', true);
    const s0 = e.compute(1_700_000_000_000);
    const before = !!s0.loads.lamp?.energized;
    e.setTripped('fr', true);
    const s1 = e.compute(1_700_000_000_100);
    return !before && !!s1.devices.fr?.closed && !!s1.loads.lamp?.energized;
  })());
}

/* ---------------------------------------------------------- 4. 引脚与标号 */
console.log('\n[4] 包围盒与标号位置');
{
  const fr = T('fr_main');
  const b = typeBounds(fr);
  check('热元件包围盒覆盖整个框体', b.minX === -112 && b.maxX === 112, `${b.minX}…${b.maxX}`);
  const labelX = b.minX - (fr.labelGap ?? 14);
  check('热元件标号落在框体左侧之外', labelX < b.minX - 10, `label x=${labelX}`);
  check('热元件仍保留 6 个接线引脚', fr.pins.length === 6);
  check('按钮标号与 E 形推杆不重叠', (T('sb_no').labelGap ?? 14) > 30, String(T('sb_no').labelGap));
  check('行程开关标号在撞块之外', (T('sq_no').labelGap ?? 14) >= 30, String(T('sq_no').labelGap));
}


/* ---------------------------------------------------------- 5. 辅助触点 */
console.log('\n[5] 辅助触点 KM / KA / KT 瞬动（国标斜刀 + 短路片）');
{
  const no = drawSymbol(T('km_no'), { closed: false });
  const noOn = drawSymbol(T('km_no'), { closed: true });
  check('常开：断态斜刀 -30°', attr(aux(no), 'data-angle') === '-30', attr(aux(no), 'data-angle'));
  check('常开：静触头无短路片', !no.includes('class="contact-bar"'));
  check('常开：不画实心节点圆点', !/<circle[^>]*r="2/.test(no));
  check('常开：闭合时斜刀回正', attr(aux(noOn), 'data-angle') === '0');

  const nc = drawSymbol(T('km_nc'), { closed: true });
  const ncOff = drawSymbol(T('km_nc'), { closed: false });
  check('常闭：短路片长 18、朝右折出', nc.includes('x1="0" y1="-7" x2="18" y2="-7"'), 'bar');
  check('常闭：闭合 40° 斜穿短路片', attr(aux(nc), 'data-angle') === '40');
  const tip = (attr(aux(nc), 'data-tip') || '').split(',').map(Number);
  check('常闭：刀尖落在片端以内（不超出短路片）', tip[0] > 8 && tip[0] < 18, `tipX=${tip[0]}`);
  check('常闭：刀尖高于短路片（穿过后略出头）', tip[1] < -7, `tipY=${tip[1]}`);
  check('常闭：断开 -22°、刀身退回左侧', attr(aux(ncOff), 'data-angle') === '-22');

  check('中间继电器常闭与接触器常闭同画法',
    drawSymbol(T('ka_nc'), { closed: true }) === drawSymbol(T('km_nc'), { closed: true }));
  const instNc = drawSymbol(T('kt_inst_nc'), { closed: false });
  check('KT 瞬动动断：无延时伞弧', !instNc.includes('timer-delay') && !instNc.includes('data-delay'));
  check('KT 瞬动动断：与辅助常闭同画法', instNc === ncOff);
  const instNo = drawSymbol(T('kt_inst_no'), { closed: false });
  check('KT 瞬动动合：斜刀常开，无伞弧', attr(aux(instNo), 'data-angle') === '-30' && !instNo.includes('timer-delay'));
}

/* ---------------------------------------------------------- 6. 主触头 */
console.log('\n[6] 接触器主触头（静触头小方钩）');
{
  const main = drawSymbol(T('km_no_3p'), { closed: false });
  check('三极各一个主触头', (main.match(/class="main-contact"/g) || []).length === 3);
  check('每极静触头下端带小方钩', (main.match(/class="main-contact"[\s\S]*?<path d="M -?\d+ -17 L/g) || []).length >= 1 &&
    main.includes('L -86.5 -17 L -86.5 -26 L -80 -26'));
  check('主触头不再画实心节点', !/<circle[^>]*r="2/.test(main));
  check('三极之间不绘画虚线联锁（按国标图形）', !main.includes('stroke-dasharray="4 3"'));
  const on = drawSymbol(T('km_no_3p'), { closed: true });
  check('闭合：三把斜刀全部回正', (on.match(/rotate\(0 /g) || []).length === 3);
}

/* ---------------------------------------------------------- 7. 空气开关 */
console.log('\n[7] 空气开关（× 标记 + 斜刀 + 极间点线）');
{
  const one = drawSymbol(T('qf_1p'), { closed: false });
  check('单极：静触头端有「×」标记（两条交叉斜线）', one.includes('y1="-16" x2="5" y2="-6"') && one.includes('y1="-6" x2="5" y2="-16"'));
  check('单极：斜刀断态 -30°', attr(pole(one), 'data-angle') === '-30');
  check('单极：不画实心节点圆点', !/<circle[^>]*r="2/.test(one));
  const oneOn = drawSymbol(T('qf_1p'), { closed: true });
  check('单极：合闸回正', attr(pole(oneOn), 'data-angle') === '0');
  const two = drawSymbol(T('qf_2p'), { closed: false });
  check('两极：两个极 + 点线联动', (two.match(/class="breaker-pole"/g) || []).length === 2 && two.includes('class="breaker-link"'));
  const link = (two.match(/class="breaker-link"[^>]*/) || [])[0] || '';
  check('两极：点线用短划圆点（stroke-dasharray 1.6 3.6）', link.includes('stroke-dasharray="1.6 3.6"'), link.slice(0, 80));
  check('两极：点线两端落在两把斜刀上', Math.abs(Number((link.match(/x1="([-\d.]+)"/) || [])[1]) - -29.8) < 0.1, (link.match(/x1="[-\d.]+"/) || [])[0]);
  const three = drawSymbol(T('qf_3p'), { closed: false });
  check('三极：三个极', (three.match(/class="breaker-pole"/g) || []).length === 3);
  const trip = drawSymbol(T('qf_2p'), { closed: true, tripped: true });
  check('脱扣：整只变红', trip.includes('#d63a3a'));
}

/* ---------------------------------------------------------- 8. 插座 */
console.log('\n[8] 插座（两眼 / 三眼 / 三相）');
{
  const s1 = drawSymbol(T('socket_1p'), {});
  check('单相两眼：圆 + 两个竖插孔', s1.includes('<circle cx="0" cy="0" r="17"') &&
    s1.includes('x1="-6" y1="-5" x2="-6" y2="5"') && s1.includes('x1="6" y1="-5" x2="6" y2="5"'));
  check('单相两眼：上下各一条引线到引脚', s1.includes('y1="-36" x2="0" y2="-17"') && s1.includes('y1="17" x2="0" y2="36"'));

  const s3 = drawSymbol(T('socket_3w'), {});
  check('单相三眼：圆内三个插孔', s3.includes('x1="0" y1="-11" x2="0" y2="-3"') &&
    s3.includes('x1="-8" y1="2" x2="-8" y2="12"') && s3.includes('x1="8" y1="2" x2="8" y2="12"'));
  check('单相三眼：PE 自上、L/N 自下引出', s3.includes('y1="-44" x2="0" y2="-17"') &&
    s3.includes('y1="15" x2="-8" y2="44"') && s3.includes('y1="15" x2="8" y2="44"'));
  check('单相三眼：负载取 L/N 两极', (T('socket_3w').loadPins || []).join(',') === 'L,N');

  const s3ph = drawSymbol(T('socket_3ph'), {});
  check('三相插座：两个下半圆插孔（凸向下）', (s3ph.match(/A 10 10 0 0 0/g) || []).length === 2);
  check('三相插座：三条引线（左斜 / 中竖 / 右斜）',
    s3ph.includes('x2="-38" y2="-26"') && s3ph.includes('x2="38" y2="-26"') && s3ph.includes('x2="0" y2="-40"'));
  check('三相插座：三极元件库定义', T('socket_3ph').pins.length === 3);
  check('插头符号仍保留（半圆凸头 + 插针）', drawSymbol(T('xp_plug'), {}).includes('A 12 12 0 0 0'));
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
if (fail) process.exit(1);
