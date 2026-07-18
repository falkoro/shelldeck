// events split L61-206
document.addEventListener('click', async (event: MouseEvent) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const copyButton = target.closest<HTMLElement>('[data-copy]');
  const createButton = target.closest<HTMLButtonElement>('[data-create]');
  const startButton = target.closest<HTMLButtonElement>('[data-start]');
  const stopButton = target.closest<HTMLButtonElement>('[data-stop]');
  const restartButton = target.closest<HTMLButtonElement>('[data-restart]');
  const keyButton = target.closest<HTMLButtonElement>('[data-key]');
  const sendButton = target.closest<HTMLButtonElement>('[data-send-shell]');
  const pasteButton = target.closest<HTMLButtonElement>('[data-paste-shell]');
  const imageButton = target.closest<HTMLButtonElement>('[data-add-image]');
  const dictateButton = target.closest<HTMLButtonElement>('[data-dictate-shell]');
  const historyButton = target.closest<HTMLButtonElement>('[data-history]');
  const copyOutputButton = target.closest<HTMLButtonElement>('[data-copy-output]');
  const privacyButton = target.closest<HTMLButtonElement>('[data-privacy-shell]');
  const containerPrivacyButton = target.closest<HTMLButtonElement>('[data-container-privacy]');
  const renameShellButton = target.closest<HTMLButtonElement>('[data-rename-shell]');
  const resetShellLabelButton = target.closest<HTMLButtonElement>('[data-reset-shell-label]');
  const renameSensorButton = target.closest<HTMLButtonElement>('[data-rename-sensor]');
  const containerActionButton = target.closest<HTMLButtonElement>('[data-container-action]');
  const editDescButton = target.closest<HTMLElement>('[data-edit-desc]');
  const shellinButton = target.closest<HTMLButtonElement>('[data-shellin]');
  const resumeButton = target.closest<HTMLButtonElement>('[data-resume]');
  const removeImageButton = target.closest<HTMLButtonElement>('[data-remove-image]');
  const removeClosedButton = target.closest<HTMLButtonElement>('[data-remove-closed]');
  const restoreHiddenButton = target.closest<HTMLButtonElement>('[data-restore-hidden-closed]');
  const tabButton = target.closest<HTMLButtonElement>('[data-shell-tab]');
  const pinButton = target.closest<HTMLButtonElement>('[data-pin-session]');
  const selectItem = target.closest<HTMLElement>('[data-select-session]');
  const interactive = target.closest('textarea,input,button,a,pre');
  try {
    if (pinButton) {
      const name = pinButton.dataset.pinSession || '';
      if (name) {
        toggleSessionPin(name);
        if (typeof invalidateSessionRail === 'function') invalidateSessionRail();
        if (typeof invalidateShellTabs === 'function') invalidateShellTabs();
        renderShellTabs();
        if (typeof renderSessionRail === 'function') renderSessionRail();
        toast(isSessionPinned(name, pinnedSessionNames()) ? 'Pinned' : 'Unpinned');
      }
      return;
    }
    if (copyButton) return copyText(copyButton.dataset.copy || '');
    if (sendButton && !sendButton.disabled) return sendInput(sendButton.dataset.sendShell || '', true);
    if (pasteButton && !pasteButton.disabled) return sendInput(pasteButton.dataset.pasteShell || '', false);
    if (dictateButton && !dictateButton.disabled) {
      await toggleDictation(dictateButton.dataset.dictateShell || '');
      return;
    }
    if (historyButton) return cycleHistory(historyButton.dataset.history || '', 1);
    if (copyOutputButton) return copyShellOutput(copyOutputButton.dataset.copyOutput || '');
    if (privacyButton) return toggleShellPrivacy(privacyButton.dataset.privacyShell || '');
    if (containerPrivacyButton) return toggleContainerPrivacy(containerPrivacyButton.dataset.containerPrivacy || '');
    if (renameShellButton) {
      const name = renameShellButton.dataset.renameShell || '';
      if (name && renameShellLabel(name)) {
        renderShells({ shells: latestShells });
        toast('Renamed');
      }
      return;
    }
    if (resetShellLabelButton) {
      const name = resetShellLabelButton.dataset.resetShellLabel || '';
      if (name && resetShellLabel(name)) {
        renderShells({ shells: latestShells });
        toast('Using auto title');
      }
      return;
    }
    if (renameSensorButton) return renameSensorLabel(renameSensorButton.dataset.renameSensor || '');
    if (containerActionButton) {
      const d = containerActionButton.dataset;
      return containerAction(d.chost || '', d.cengine || '', d.cname || '', d.containerAction || '');
    }
    if (editDescButton) return editContainerDescription(editDescButton.dataset.editDesc || '');
    if (shellinButton) {
      openTerminal(shellinButton.dataset.shellin || '');
      return;
    }
    const minimizeShellButton = target.closest<HTMLButtonElement>('[data-minimize-shell]');
    if (minimizeShellButton) {
      minimizeShellPreview(minimizeShellButton.dataset.minimizeShell || '');
      return;
    }
    const maximizePreviewButton = target.closest<HTMLButtonElement>('[data-maximize-preview]');
    if (maximizePreviewButton) {
      maximizeShellPreview(maximizePreviewButton.dataset.maximizePreview || '');
      return;
    }
    if (resumeButton && resumeButton.dataset.resumeCmd) return runCommand(resumeButton.dataset.resume || '', resumeButton.dataset.resumeCmd);
    if (removeImageButton) return removeShellImage(removeImageButton.dataset.shell || '', removeImageButton.dataset.removeImage || '');
    if (removeClosedButton) return removeClosedShell(removeClosedButton.dataset.removeClosed || '');
    const removeAllOfflineButton = target.closest<HTMLButtonElement>('[data-remove-all-offline]');
    if (removeAllOfflineButton) {
      removeAllOfflineSessions();
      return;
    }
    if (restoreHiddenButton) return restoreHiddenClosedShells();
    if (tabButton) {
      selectSession(tabButton.dataset.shellTab);
      return;
    }
    if (imageButton && !imageButton.disabled) {
      pendingImageTarget = imageButton.dataset.addImage || selectedSession;
      imageFile.click();
      return;
    }
    if (createButton && !createButton.disabled) {
      const baseName = createButton.dataset.create || '';
      const requestedName = promptNewTmuxSessionName(baseName, Boolean(sessionByName(baseName)?.running));
      if (requestedName === null) return;
      const targetName = requestedName || baseName;
      unhideShell(targetName);
      const payload = await sessionAction('/api/create', baseName, { sessionName: requestedName });
      return selectSession(payload.sessionName || targetName);
    }
    if (startButton && !startButton.disabled) {
      unhideShell(startButton.dataset.start || '');
      await sessionAction('/api/start', startButton.dataset.start || '');
      return selectSession(startButton.dataset.start);
    }
    if (stopButton && !stopButton.disabled) {
      const stopped = stopButton.dataset.stop || '';
      if (!armShellDangerAction(stopButton, 'stop', stopped)) return;
      await sessionAction('/api/stop', stopped);
      terminateShellInDashboard(stopped);
      return;
    }
    if (restartButton && !restartButton.disabled) {
      const restarted = restartButton.dataset.restart || '';
      if (!armShellDangerAction(restartButton, 'restart', restarted)) return;
      unhideShell(restarted);
      await sessionAction('/api/restart', restarted);
      return selectSession(restarted);
    }
    if (keyButton && !keyButton.disabled) return sendKey(keyButton.dataset.shell || '', keyButton.dataset.key || '');
    // Select when clicking a session/card — allow the case where the clicked interactive element
    // IS the select target itself (the sidebar session items are <button data-select-session>),
    // but still ignore clicks on inner controls (textarea/pre inside a card).
    if (selectItem && (!interactive || interactive === selectItem)) {
      const sessionName = selectItem.dataset.selectSession || '';
      selectSession(sessionName);
      // Live center always attaches tmux in the stage (selectSession opens it when unlocked).
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
});

