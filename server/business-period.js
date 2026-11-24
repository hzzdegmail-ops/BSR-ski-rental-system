import { day, dateAfter, iso, requireRule } from './data.js';

export function businessPeriod(body, cutoff) {
  const fromDay = body.from || day(dateAfter(-30,cutoff));
  const toDay = body.to || day(cutoff);
  const isDay = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  requireRule(isDay(fromDay) && isDay(toDay),'请选择有效的统计日期');
  const from = iso(fromDay+'T00:00:00+08:00','统计开始日期');
  const to = iso(toDay+'T23:59:59.999+08:00','统计结束日期');
  requireRule(day(from)===fromDay && day(to)===toDay && from<=to,'请选择起止顺序正确的统计日期');
  return {from,to,fromDay,toDay};
}
