import React from 'react';
import ReactDOM from 'react-dom/client';
import ErrorBoundary from './components/layout/ErrorBoundary';
import { collectPlatformHints, getAppPlatform } from './platform';
import { initUiThemeEarly } from './lib/uiTheme';
import './styles/globals.css';

async function bootstrap() {
  const hints = collectPlatformHints();
  const platform = getAppPlatform(hints);
  // Visible in DevTools — if you still see desktop, force did not apply
  console.info(`[marcel] platform=${platform}`, hints);

  document.documentElement.dataset.marcelPlatform = platform;

  // 设置异步加载之前先应用上次的主题（localStorage 缓存），避免浅色用户先看到一帧深色。
  initUiThemeEarly();

  // Window starts visible:false. Desktop App calls appReady; mobile must too.
  // Fire ASAP so a late React mount never leaves an invisible process.
  if (platform === 'mobile') {
    void import('@/lib/tauri')
      .then((m) => m.appReady())
      .catch(() => {});
  }

  const RootApp =
    platform === 'mobile'
      ? (await import('./mobile/App')).default
      : (await import('./App')).default;

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <RootApp />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void bootstrap();
