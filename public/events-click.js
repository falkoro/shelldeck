"use strict";
// events split L61-206
document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target)
        return;
    const copyButton = target.closest('[data-copy]');
    const createButton = target.closest('[data-create]');
    const startButton = target.closest('[data-start]');
    const stopButton = target.closest('[data-stop]');
    const restartButton = target.closest('[data-restart]');
    const keyButton = target.closest('[data-key]');
    const sendButton = target.closest('[data-send-shell]');
    const pasteButton = target.closest('[data-paste-shell]');
    const imageButton = target.closest('[data-add-image]');
    const dictateButton = target.closest('[data-dictate-shell]');
    const historyButton = target.closest('[data-history]');
    const copyOutputButton = target.closest('[data-copy-output]');
    const privacyButton = target.closest('[data-privacy-shell]');
    const containerPrivacyButton = target.closest('[data-container-privacy]');
    const renameShellButton = target.closest('[data-rename-shell]');
    const resetShellLabelButton = target.closest('[data-reset-shell-label]');
    const renameSensorButton = target.closest('[data-rename-sensor]');
    const containerActionButton = target.closest('[data-container-action]');
    const editDescButton = target.closest('[data-edit-desc]');
    const shellinButton = target.closest('[data-shellin]');
    const resumeButton = target.closest('[data-resume]');
    const removeImageButton = target.closest('[data-remove-image]');
    const removeClosedButton = target.closest('[data-remove-closed]');
    const restoreHiddenButton = target.closest('[data-restore-hidden-closed]');
    const tabButton = target.closest('[data-shell-tab]');
    const pinButton = target.closest('[data-pin-session]');
    const selectItem = target.closest('[data-select-session]');
    const interactive = target.closest('textarea,input,button,a,pre');
    try {
        if (pinButton) {
            const name = pinButton.dataset.pinSession || '';
            if (name) {
                toggleSessionPin(name);
                if (typeof invalidateSessionRail === 'function')
                    invalidateSessionRail();
                if (typeof invalidateShellTabs === 'function')
                    invalidateShellTabs();
                renderShellTabs();
                if (typeof renderSessionRail === 'function')
                    renderSessionRail();
                toast(isSessionPinned(name, pinnedSessionNames()) ? 'Pinned' : 'Unpinned');
            }
            return;
        }
        if (copyButton)
            return copyText(copyButton.dataset.copy || '');
        if (sendButton && !sendButton.disabled)
            return sendInput(sendButton.dataset.sendShell || '', true);
        if (pasteButton && !pasteButton.disabled)
            return sendInput(pasteButton.dataset.pasteShell || '', false);
        if (dictateButton && !dictateButton.disabled) {
            await toggleDictation(dictateButton.dataset.dictateShell || '');
            return;
        }
        if (historyButton)
            return cycleHistory(historyButton.dataset.history || '', 1);
        if (copyOutputButton)
            return copyShellOutput(copyOutputButton.dataset.copyOutput || '');
        if (privacyButton)
            return toggleShellPrivacy(privacyButton.dataset.privacyShell || '');
        if (containerPrivacyButton)
            return toggleContainerPrivacy(containerPrivacyButton.dataset.containerPrivacy || '');
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
        if (renameSensorButton)
            return renameSensorLabel(renameSensorButton.dataset.renameSensor || '');
        if (containerActionButton) {
            const d = containerActionButton.dataset;
            return containerAction(d.chost || '', d.cengine || '', d.cname || '', d.containerAction || '');
        }
        if (editDescButton)
            return editContainerDescription(editDescButton.dataset.editDesc || '');
        if (shellinButton) {
            openTerminal(shellinButton.dataset.shellin || '');
            return;
        }
        const minimizeShellButton = target.closest('[data-minimize-shell]');
        if (minimizeShellButton) {
            minimizeShellPreview(minimizeShellButton.dataset.minimizeShell || '');
            return;
        }
        const maximizePreviewButton = target.closest('[data-maximize-preview]');
        if (maximizePreviewButton) {
            maximizeShellPreview(maximizePreviewButton.dataset.maximizePreview || '');
            return;
        }
        if (resumeButton && resumeButton.dataset.resumeCmd)
            return runCommand(resumeButton.dataset.resume || '', resumeButton.dataset.resumeCmd);
        if (removeImageButton)
            return removeShellImage(removeImageButton.dataset.shell || '', removeImageButton.dataset.removeImage || '');
        if (removeClosedButton)
            return removeClosedShell(removeClosedButton.dataset.removeClosed || '');
        if (restoreHiddenButton)
            return restoreHiddenClosedShells();
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
            if (requestedName === null)
                return;
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
            if (!armShellDangerAction(stopButton, 'stop', stopped))
                return;
            await sessionAction('/api/stop', stopped);
            terminateShellInDashboard(stopped);
            return;
        }
        if (restartButton && !restartButton.disabled) {
            const restarted = restartButton.dataset.restart || '';
            if (!armShellDangerAction(restartButton, 'restart', restarted))
                return;
            unhideShell(restarted);
            await sessionAction('/api/restart', restarted);
            return selectSession(restarted);
        }
        if (keyButton && !keyButton.disabled)
            return sendKey(keyButton.dataset.shell || '', keyButton.dataset.key || '');
        // Select when clicking a session/card — allow the case where the clicked interactive element
        // IS the select target itself (the sidebar session items are <button data-select-session>),
        // but still ignore clicks on inner controls (textarea/pre inside a card).
        if (selectItem && (!interactive || interactive === selectItem)) {
            const sessionName = selectItem.dataset.selectSession || '';
            selectSession(sessionName);
            // Live center always attaches tmux in the stage (selectSession opens it when unlocked).
        }
    }
    catch (error) {
        toast(error instanceof Error ? error.message : String(error));
    }
});
