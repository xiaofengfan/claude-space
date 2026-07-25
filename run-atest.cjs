/**
 * 银行监管知识图谱系统 — 全流程开发编排
 * 创建编排 → 启动 → 持续监控直到完成
 */
const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  console.log('\n=== 银行监管知识图谱系统 — 全流程编排 ===\n');

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

  // Step 1: 清理之前失败/中断的编排
  console.log('Step 1: 清理之前的编排...');
  await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.orchestrator;
      const listRes = await api.list('E:/claudespace/ATEST');
      if (!listRes.ok) return { cleaned: 0 };
      let cleaned = 0;
      for (const o of listRes.data) {
        if (o.status === 'running' || o.status === 'failed' || o.status === 'interrupted') {
          await api.stop(o.id).catch(() => {});
          cleaned++;
        }
      }
      return { cleaned, total: listRes.data.length };
    })()
  `).then(r => console.log('  清理:', JSON.stringify(r)));

  // Step 2: 创建银行监管知识图谱系统编排
  console.log('\nStep 2: 创建编排...');
  const createResult = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.orchestrator;
      const createRes = await api.create({
        repoPath: 'E:/claudespace/ATEST',
        templateId: 'greenfield',
        goal: '开发银行监管知识图谱系统：1)监管法规知识抽取与结构化 2)机构/人员/账户实体关系建模 3)风险传导路径分析 4)监管规则查询引擎。技术栈：Python 3.11 + FastAPI + Neo4j + Pydantic + pytest。需要创建完整项目结构、核心模块、API 接口和单元测试。',
        autoApprove: true,
        testCommand: 'pytest',
      });
      if (!createRes.ok) return { error: createRes.error?.message };
      const orchId = createRes.data.id;
      const statusRes = await api.status(orchId);
      return {
        orchId,
        taskCount: statusRes.ok ? statusRes.data.tasks.length : 0,
        tasks: statusRes.ok ? statusRes.data.tasks.map(t => t.id + '(' + t.title + ')') : [],
      };
    })()
  `);
  console.log('  创建结果:', JSON.stringify(createResult, null, 2));

  if (createResult.error) {
    console.log('\n✗ 创建失败，退出');
    app.quit();
    return;
  }

  const orchId = createResult.orchId;
  console.log('  编排 ID:', orchId);
  console.log('  任务数:', createResult.taskCount);

  // Step 3: 启动编排
  console.log('\nStep 3: 启动编排...');
  const startResult = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.orchestrator;
      const startRes = await api.start('${orchId}');
      return { ok: startRes.ok, error: startRes.error?.message };
    })()
  `);
  console.log('  启动结果:', JSON.stringify(startResult));

  if (!startResult.ok) {
    console.log('\n✗ 启动失败，退出');
    app.quit();
    return;
  }

  // Step 4: 持续监控编排执行
  console.log('\nStep 4: 监控编排执行...\n');
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
              attempts: t.attempts, lastError: t.lastError,
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
        console.log('  编排状态: ' + orchStatus);
        console.log('  进度: ' + done.length + '/' + status.tasks.length + ' 完成, ' + running.length + ' 执行中, ' + failed.length + ' 失败, ' + pending.length + ' 待执行');
        if (runningTask) {
          console.log('  当前执行: ' + runningTask.id + ' - ' + runningTask.title + ' (phase: ' + runningTask.phase + ')');
        }
        if (failed.length > 0) {
          for (const f of failed) {
            console.log('  ✗ 失败: ' + f.id + ' - ' + f.title + (f.lastError ? ' | 错误: ' + f.lastError : ''));
          }
        }
        lastPhase = currentPhase;
      } else {
        process.stdout.write('.');
      }

      if (orchStatus === 'success') {
        console.log('\n\n✓ 编排执行完成！');
        console.log('  总任务: ' + status.tasks.length);
        console.log('  完成: ' + done.length);
        console.log('  失败: ' + failed.length);
        return false;
      }
      if (orchStatus === 'failed' || orchStatus === 'interrupted') {
        console.log('\n\n✗ 编排执行' + (orchStatus === 'failed' ? '失败' : '已中断'));
        for (const f of failed) {
          console.log('    - ' + f.id + ': ' + f.title + (f.lastError ? ' | ' + f.lastError : ''));
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
      console.log('\n=== 编排执行结束 ===');
      // 检查生成的文件
      console.log('\n检查 ATEST 项目文件...');
      const fs = require('fs');
      const path = require('path');
      const atestPath = 'E:/claudespace/ATEST';
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

  // 最长运行 2 小时
  setTimeout(() => {
    console.log('\n超时退出（2小时）');
    clearInterval(timer);
    app.quit();
  }, 2 * 60 * 60 * 1000);

}).catch(e => {
  console.error('启动失败:', e);
  app.quit();
});
