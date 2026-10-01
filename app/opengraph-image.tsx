// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const alt = 'Taka Sats — verified recycling work with transparent Bitcoin payouts';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  const icon = await readFile(join(process.cwd(), 'app', 'icon.png'));
  const iconDataUrl = `data:image/png;base64,${icon.toString('base64')}`;

  return new ImageResponse(
    <div
      style={{
        alignItems: 'center',
        background: '#FAF8F4',
        color: '#141414',
        display: 'flex',
        height: '100%',
        justifyContent: 'space-between',
        padding: '72px 76px',
        position: 'relative',
        width: '100%',
      }}
    >
      <div
        style={{
          background: 'rgb(247 147 26)',
          bottom: 0,
          display: 'flex',
          height: 18,
          left: 0,
          position: 'absolute',
          right: 0,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', width: 720 }}>
        <div
          style={{
            alignItems: 'center',
            color: '#3E6336',
            display: 'flex',
            fontSize: 27,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          Waste to Bitcoin · Earn first
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 70,
            fontWeight: 700,
            letterSpacing: -3,
            lineHeight: 1.02,
            marginTop: 34,
          }}
        >
          <span>Recycling work,</span>
          <span style={{ color: '#3E6336' }}>verified.</span>
          <span>Bitcoin paid.</span>
        </div>
        <div style={{ color: '#68645E', display: 'flex', fontSize: 27, marginTop: 34 }}>
          Offline-first collection · Linked evidence · Transparent payouts
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="" height="330" src={iconDataUrl} style={{ height: 330, width: 330 }} width="330" />
    </div>,
    size,
  );
}
