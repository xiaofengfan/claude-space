/**
 * 在已运行的 Electron 窗口中启动编排并持续监控
 */
const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  console.log('\n=== UI 编排启动 ===\n');

  require('./dist-electron/main.js');
  await new Promise(r => setTimeout(r, 5000));

  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    console.log('✗ 没有窗口');
    app.quit();
    return;
  }

  const win = windows[0];
  await new Promise(r => setTimeout(r, 3000));

  // Step 1: 列出 ATEST 项目的编排
  console.log('Step 1: 列出 ATEST 项目编排...');
  const listResult = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.orchestrator;
      const listRes = await api.list('E:/claudespace/ATEST');
      if (!listRes.ok) return { error: listRes.error?.message };
      return {
        count: listRes.data.length,
        orchs: listRes.data.map(o => ({
          id: o.id, status: o.status, templateId: o.templateId,
          goal: (o.goal || '').slice(0, 50),
        })),
      };
    })()
  `);
  console.log('  ATEST 编排:', JSON.stringify(listResult, null, 2));

  // Step 2: 找到 pending 状态的编排并启动
  console.log('\nStep 2: 查找并启动 pending 编排...');
  const startResult = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.orchestrator;
      const listRes = await api.list('E:/claudespace/ATEST');
      if (!listRes.ok) return { error: '无法列出编排' };

      // 找 pending 或 failed/interrupted 的编排
      let target = listRes.data.find(o => o.status === 'pending');
      if (!target) {
        // 找最近的 failed/interrupted，重新启动
        target = listRes.data.find(o => o.status === 'failed' || o.status === 'interrupted');
      }

      if (!target) {
        // 创建新的编排
        const createRes = await api.create({
          repoPath: 'E:/claudespace/ATEST',
          templateId: 'greenfield',
          goal: '开发银行监管知识图谱系统：1)监管法规知识抽取与结构化 2)机构/人员/账户实体关系建模 3)风险传导路径分析 4)监管规则查询引擎。技术栈：Python 3.11 + FastAPI + Neo4j + Pydantic + pytest。',
          autoApprove: true,
          testCommand: 'pytest',
        });
        if (!createRes.ok) return { error: '创建失败: ' + (createRes.error?.message || 'unknown') };
        target = createRes.data;
      }

      const orchId = target.id;
      const statusRes = await api.status(orchId);

      // 如果是 failed/interrupted，先 stop 再 start
      if (target.status === 'failed' || target.status === 'interrupted' || target.status === 'running') {
        await api.stop(orchId).catch(() => {});
      }

      const startRes = await api.start(orchId);
      return {
        orchId,
        startOk: startRes.ok,
        startError: startRes.error?.message,
        taskCount: statusRes.ok ? statusRes.data.tasks.length : 0,
        tasks: statusRes.ok ? statusRes.data.tasks.map(t => ({ id: t.id, title: t.title, status: t.status, phase: t.phase })) : [],
      };
    })()
  `);
  console.log('  启动结果:', JSON.stringify(startResult, null, 2));

  if (startResult.error) {
    console.log('\n✗ 失败:', startResult.error);
    app.quit();
    return;
  }

  const orchId = startResult.orchId;
  console.log('\n  编排 ID:', orchId);
  console.log('  任务数:', startResult.taskCount);

  // Step 3: 持续监控
  console.log('\nStep 3: 持续监控...\n');
  let pollCount = 0;
  let lastPhase = '';

  const poll = async () => {
    pollCount++;
    try {
      const status = await win.webContents.executeJavaScript(`
        (async () => {
          const api = window.orchestrator;
          const res = await api.status('${orchId}');
          if (!res.ok || !res.data) return null;
          return {
            status: res.data.orchestration.status,
            tasks: res.data.tasks.map(t => ({
              id: t.id, title: t.title, status: t.status, phase: t.phase,
              lastError: t.lastError,
            })),
          };
        })()
      `);

      if (!status) {
        console.log('[' + new Date().toLocaleTimeString() + '] 轮询 #' + pollCount + ': 无法获取状态');
        return true;
      }

      const orchStatus = status.status;
      const running = status.tasks.filter(t => t.status === 'running');
      const done = status.tasks.filter(t => t.status === 'done');
      const failed = status.tasks.filter(t => t.status === 'failed');
      const pending = status.tasks.filter(t => t.status === 'pending' || t.status === 'ready');

      const runningTask = running[0];
      const currentPhase = runningTask ? runningTask.phase : '';

      if (currentPhase !== lastPhase || pollCount === 1) {
        console.log('[' + new Date().toLocaleTimeString() + '] 轮询 #' + pollCount);
        console.log('  状态: ' + orchStatus + ' | 进度: ' + done.length + '/' + status.tasks.length + ' 完成, ' + running.length + ' 执行中, ' + failed.length + ' 失败');
        if (runningTask) {
          console.log('  执行中: ' + runningTask.id + ' - ' + runningTask.title + ' (' + runningTask.phase + ')');
        }
        if (failed.length > 0) {
          for (const f of failed) {
            console.log('  ✗ 失败: ' + f.id + ' - ' + f.title + (f.lastError ? ' | ' + f.lastError : ''));
          }
        }
        lastPhase = currentPhase;
      } else {
        process.stdout.write('.');
      }

      if (orchStatus === 'success' || orchStatus === 'failed' || orchStatus === 'interrupted') {
        console.log('\n\n=== 编排' + (orchStatus === 'success' ? '完成' : orchStatus === 'failed' ? '失败' : '已中断') + ' ===');
        console.log('  完成: ' + done.length + '/' + status.tasks.length);
        if (failed.length > 0) {
          for (const f of failed) {
            console.log('  ✗ ' + f.id + ': ' + f.title + (f.lastError ? ' | ' + f.lastError : ''));
          }
        }
        return false;
      }
    } catch (e) {
      console.log('\n[' + new Date().toLocaleTimeString() + '] 轮询异常: ' + e.message);
    }
    return true;
  };

  const shouldContinue = await poll();
  if (!shouldContinue) {
    app.quit();
    return;
  }

  // 每 30 秒检查一次
  const timer = setInterval(async () => {
    const cont = await poll();
    if (!cont) {
      clearInterval(timer);
      console.log('\n=== 监控结束 ===');
      // 检查生成的文件
      const fs = require('fs');
      const path = require('path');
      const atestPath = 'E:/claudespace/ATEST';
      console.log('\nATEST 项目文件:');
      function listFiles(dir, prefix) {
        prefix = prefix || '';
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue;
            const fullPath = path.join(dir, e.name);
            if (e.isDirectory()) {
              console.log(prefix + e.name + '/');
              listFiles(fullPath, prefix + '  ');
            } else {
              const stat = fs.statSync(fullPath);
              console.log(prefix + e.name + ' (' + stat.size + ' bytes)');
            }
          }
        } catch {}
      }
      listFiles(atestPath);
      setTimeout(() => app.quit(), 2000);
    }
  }, 30000);

  // 2 小时超时
  setTimeout(() => {
    console.log('\n超时退出');
    clearInterval(timer);
    app.quit();
  }, 2 * 60 * 60 * 1000);
}).catch(e => {
  console.error('失败:', e);
  app.quit();
});
