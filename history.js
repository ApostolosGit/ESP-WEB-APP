/* Energy history: signed net kWh, with no third-party chart library. */
window.EnergyHistory = (() => {
  'use strict';

  const DAY = 86400000;
  const HOUR = 3600;
  const dateFormat = new Intl.DateTimeFormat('el-GR', {
    timeZone:'Europe/Athens', year:'numeric', month:'numeric', day:'numeric',
    hour:'numeric', minute:'numeric', second:'numeric'
  });
  const dayFormat = new Intl.DateTimeFormat('el-GR', {
    timeZone:'UTC', day:'2-digit', month:'2-digit'
  });
  const hourFormat = new Intl.DateTimeFormat('el-GR', {
    timeZone:'Europe/Athens', day:'2-digit', month:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  });
  const athensPartsFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone:'Europe/Athens', month:'2-digit', hour:'2-digit',
    minute:'2-digit', hourCycle:'h23'
  });
  const numberFormat = new Intl.NumberFormat('el-GR', {maximumFractionDigits:3});
  const local = epoch => dateFormat.format(new Date(epoch * 1000));
  const dayLabel = day => dayFormat.format(new Date(day * DAY));
  const hourLabel = epoch => hourFormat.format(new Date(epoch * 1000));
  const number = n => numberFormat.format(Number(n));
  const zoneNames = ['Ζ1','Ζ2 πρωί','Ζ2 βράδυ'];
  const colors = ['#ff9800','#ffd600','#000000'];
  const xml = value => String(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;');

  function tariffZone(epoch) {
    const parts = athensPartsFormat.formatToParts(new Date(epoch * 1000));
    const value = type => Number(parts.find(part => part.type === type)?.value || 0);
    const month = value('month');
    const minute = value('hour') * 60 + value('minute');
    const winter = month >= 11 || month <= 3;

    // Same three stored V5 bands as the firmware:
    // normal Z1, daytime reduced window, night/early-morning reduced window.
    if (minute >= 120 && minute < (winter ? 300 : 240)) return 2;
    if (minute >= (winter ? 720 : 660) && minute < 900) return 1;
    return 0;
  }

  function daily(rows, days, today) {
    const byDay = new Map(rows.map(row => [row.day, row]));
    // Newest first, as requested for the 30-day view.
    return Array.from({length:days}, (_, i) => {
      const day = today - i;
      const row = byDay.get(day);
      return {
        label:dayLabel(day),
        // V5 stores [Z1 import/export, Z2-night import/export, Z2-day import/export].
        // Display order is Z1, Z2 πρωί, Z2 βράδυ using the two distinct Z2 windows.
        values:row ? [
          (row.wh[0] - row.wh[1]) / 1000,
          (row.wh[4] - row.wh[5]) / 1000,
          (row.wh[2] - row.wh[3]) / 1000
        ] : null,
        flags:row?.flags ?? 32,
        detail:row
          ? `${local(row.first)} έως ${local(row.last)} · ${Math.round(row.covered/60)} λεπτά καταγραφής`
          : 'Δεν υπάρχει καταγραφή'
      };
    });
  }

  function hourly(rows, hours = 48, anchorEpoch = null) {
    const points = [...new Map(rows.map(row => [row.epoch, row])).values()]
      .sort((a,b) => a.epoch - b.epoch);
    const latestEpoch = Number.isFinite(anchorEpoch)
      ? Math.floor(anchorEpoch)
      : (points.at(-1)?.epoch || Math.floor(Date.now()/1000));
    const lastHour = Math.floor(latestEpoch / HOUR) * HOUR;
    const firstHour = lastHour - (Math.max(1, hours) - 1) * HOUR;
    const buckets = new Map();

    for (let i = 0; i < hours; ++i) {
      const epoch = firstHour + i * HOUR;
      buckets.set(epoch, {
        epoch, values:[0,0,0], covered:0, flags:0, has:false, invalid:false
      });
    }

    for (let i = 1; i < points.length; ++i) {
      const a = points[i - 1], p = points[i];
      const span = p.epoch - a.epoch;
      const valid = span > 0 && span <= 7200 &&
        a.generation === p.generation &&
        p.import >= a.import && p.export >= a.export;

      // Ignore old intervals before doing minute-level proportional splitting.
      if (p.epoch <= firstHour || a.epoch >= lastHour + HOUR) continue;

      if (!valid) {
        const midpoint = Math.floor((a.epoch + p.epoch) / 2);
        const hour = Math.floor(midpoint / HOUR) * HOUR;
        const bucket = buckets.get(hour);
        if (bucket) bucket.invalid = true;
        continue;
      }

      const netKwh = (p.import - a.import - p.export + a.export) / 1000;
      let cursor = a.epoch;
      while (cursor < p.epoch) {
        // One-minute slices make hour/tariff boundary allocation deterministic
        // and mirror the firmware's linear estimate for sparse checkpoints.
        const nextMinute = (Math.floor(cursor / 60) + 1) * 60;
        const next = Math.min(p.epoch, nextMinute);
        const midpoint = (cursor + next) / 2;
        const hour = Math.floor(midpoint / HOUR) * HOUR;
        const bucket = buckets.get(hour);
        if (bucket) {
          const seconds = next - cursor;
          bucket.values[tariffZone(midpoint)] += netKwh * seconds / span;
          bucket.covered += seconds;
          bucket.has = true;
          if (span > 2100) bucket.flags |= 2;
        }
        cursor = next;
      }
    }

    return [...buckets.values()].map(bucket => {
      if (!bucket.has) bucket.flags |= 32;
      else if (bucket.covered < 3300) bucket.flags |= 1;
      if (bucket.epoch === lastHour) bucket.flags |= 16;
      const end = bucket.epoch + HOUR;
      return {
        epoch:bucket.epoch,
        label:hourLabel(bucket.epoch),
        values:bucket.has ? bucket.values : null,
        flags:bucket.flags,
        detail:`${local(bucket.epoch)} → ${local(end)} · ${Math.round(bucket.covered/60)} λεπτά καταγραφής`
      };
    }).reverse(); // Newest hour first, matching the chart and table order.
  }

  // comparisonGroups supplies a shared Y scale and bar spacing for two
  // stacked 24-hour plots; their hour positions align while values remain
  // comparable. Existing single-chart callers can omit the third argument.
  function svg(groups, dual, comparisonGroups = groups) {
    const prepare = group => {
      if (!group.values) return null;
      const values = dual
        ? group.values.map(Number)
        : [group.values.reduce((sum, value) => sum + Number(value), 0)];
      if (!values.every(Number.isFinite)) return null;
      return {
        values,
        labels:values.map(number),
        total:values.reduce((sum, value) => sum + value, 0)
      };
    };
    const prepared = groups.map(prepare);

    let max = 0, min = 0, slot = dual ? 58 : 50;
    for (const group of comparisonGroups.map(prepare)) {
      if (!group) continue;
      if (dual) {
        const positive = group.values.filter(v => v > 0).reduce((a,b) => a+b, 0);
        const negative = group.values.filter(v => v < 0).reduce((a,b) => a+b, 0);
        max = Math.max(max, positive);
        min = Math.min(min, negative);
      } else {
        max = Math.max(max, group.total);
        min = Math.min(min, group.total);
      }
      slot = Math.max(slot, number(group.total).length * 6.5 + 22);
    }

    // Uniform, rounded ticks keep a small negative extreme from colliding
    // with zero when the positive range is much larger (and vice versa).
    const span = max - min || 1;
    const roughStep = span / 4;
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const fraction = roughStep / magnitude;
    const tickStep = [1,2,2.5,5,10].find(n => n >= fraction) * magnitude;
    min = Math.floor(min / tickStep) * tickStep;
    max = Math.ceil(max / tickStep) * tickStep;
    if (max === min) max = min + tickStep;
    const tickCount = Math.round((max - min) / tickStep);
    const tickFormat = new Intl.NumberFormat('el-GR', {
      maximumFractionDigits:Math.min(9, Math.max(3, 1 - Math.floor(Math.log10(tickStep))))
    });
    const ticks = Array.from({length:tickCount+1}, (_,i) => {
      const value = min + i * tickStep;
      return Math.abs(value) < tickStep * 1e-9 ? 0 : value;
    });
    // Reserve enough room for minus signs and large readings on both charts.
    const left = Math.max(55, ...ticks.map(value => tickFormat.format(value).length * 7 + 12));
    const right = 25;
    const width = Math.max(650, groups.length * slot + left + right);
    const height = 310, top = 28, bottom = 252;
    const range = max - min || 1;
    const y = value => bottom - (value - min) / range * (bottom - top);
    const zero = y(0);
    const step = (width - left - right) / Math.max(1, groups.length);
    let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Ισοζύγιο ενέργειας σε kWh" style="min-width:${width}px">`;

    for (const value of ticks) {
      out += `<line class="${value===0?'zero-axis':'y-grid'}" x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}" stroke="${value===0?'#526576':'#b9c9d4'}" stroke-width="${value===0?'1.5':'1'}"/><text class="y-tick" x="${left-5}" y="${y(value)+4}" text-anchor="end" fill="#526576" font-size="11">${tickFormat.format(value)}</text>`;
    }

    groups.forEach((group, i) => {
      const center = left + i * step + step / 2;
      const data = prepared[i];
      // Hourly points carry their UTC epoch. Resolve the matching tariff
      // from the midpoint in Europe/Athens (DST-safe), not from browser time.
      const hourZone = Number.isFinite(group.epoch)
        ? tariffZone(group.epoch + HOUR / 2)
        : null;
      if (!data) {
        if (!group.pending) out += `<text x="${center}" y="${zero-5}" text-anchor="middle" fill="#7a8b95" font-size="13">×</text>`;
      } else if (!dual) {
        const value = data.total;
        const yy = y(value);
        const barWidth = Math.max(8, Math.min(42, step - 10));
        const minHeight = Math.max(value === 0 ? 1 : 2, Math.abs(yy - zero));
        const barTop = value >= 0 ? Math.max(top,zero-minHeight) : zero;
        const heightPx = value >= 0 ? zero-barTop : Math.min(bottom-zero,minHeight);
        out += `<rect x="${center-barWidth/2}" y="${barTop}" width="${barWidth}" height="${heightPx}" fill="${colors[hourZone ?? 0]}" data-hour-zone="${hourZone ?? 0}" opacity="${group.flags?'.55':'1'}"><title>${xml(group.label)} · ${hourZone===null?'Ζ':zoneNames[hourZone]}: ${data.labels[0]} kWh</title></rect>`;
        const labelY = value >= 0 ? Math.max(12,yy-6) : Math.min(bottom+16,yy+14);
        out += `<text class="bar-value" x="${center}" y="${labelY}" text-anchor="middle" fill="#263d4b" font-size="11" font-weight="600">${data.labels[0]}</text>`;
      } else {
        const barWidth = Math.max(16, Math.min(44, step - 12));
        let positive = 0, negative = 0;
        data.values.forEach((value, j) => {
          if (value === 0) return;
          const from = value > 0 ? positive : negative;
          const to = from + value;
          const yFrom = y(from), yTo = y(to);
          // Expand tiny segments away from zero, never across it. A fixed
          // minimum height at the natural Y could flip their visible sign.
          const minHeight = Math.max(2, Math.abs(yTo - yFrom));
          const rectY = value > 0 ? Math.max(top,yFrom-minHeight) : yFrom;
          const rectH = value > 0 ? yFrom-rectY : Math.min(bottom-yFrom,minHeight);
          out += `<rect x="${center-barWidth/2}" y="${rectY}" width="${barWidth}" height="${rectH}" fill="${colors[j]}" data-hour-zone="${j}" opacity="${group.flags?'.62':'1'}"><title>${xml(group.label)} · ${zoneNames[j]}: ${data.labels[j]} kWh</title></rect>`;
          if (rectH >= 16) {
            out += `<text class="segment-value" x="${center}" y="${rectY+rectH/2+4}" text-anchor="middle" fill="#fff" font-size="9" font-weight="700">${data.labels[j]}</text>`;
          }
          if (value > 0) positive = to; else negative = to;
        });
        const labelY = data.total >= 0
          ? Math.max(12, y(positive) - 6)
          : Math.min(bottom + 18, y(negative) + 14);
        out += `<text class="bar-value" x="${center}" y="${labelY}" text-anchor="middle" fill="#263d4b" font-size="10" font-weight="700">Σ ${number(data.total)}</text>`;
      }

      // Show hourly X labels every two bars; the 30-day chart keeps daily labels.
      const showLabel = Number.isFinite(group.epoch)
        ? i % 2 === 0
        : (groups.length <= 30 || i % 4 === 0 || i === groups.length - 1);
      if (showLabel) {
        out += `<text x="${center}" y="282" text-anchor="middle" fill="${hourZone===null?'#526576':colors[hourZone]}" font-size="10" font-weight="${hourZone===null?'400':'700'}">${xml(group.label)}</text>`;
      }
    });

    return out + '</svg>';
  }

  return {daily,hourly,svg,local,number,tariffZone};
})();

