<script lang="ts">
  import { workspaceStore } from "../stores/workspaceStore.svelte";

  function createFirstWorkspace() {
    workspaceStore.addWorkspace();
  }

  function openFolder() {
    // Trigger folder picker via the existing mechanism
    const event = new CustomEvent('ultimate:open-folder');
    window.dispatchEvent(event);
  }
</script>

<div class="homescreen">
  <div class="homescreen-content">
    <div class="logo">
      <svg viewBox="0 0 48 48" width="64" height="64" fill="none" stroke="#4e7bf0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="6" y="6" width="36" height="36" rx="4"/>
        <line x1="6" y1="16" x2="42" y2="16"/>
        <line x1="16" y1="6" x2="16" y2="42"/>
      </svg>
    </div>
    
    <h1 class="title">Welcome to Ultimate Editor</h1>
    <p class="subtitle">Create a Workspace to Begin</p>
    
    <div class="actions">
      <button class="btn btn-primary" onclick={createFirstWorkspace}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v8M8 12h8"/>
        </svg>
        <span>New Workspace</span>
      </button>
      
    </div>
    
    <div class="shortcuts">
      <div class="shortcut">
        <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd>
        <span>New workspace</span>
      </div>
      <div class="shortcut">
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>`</kbd>
        <span>Workspace overview</span>
      </div>
    </div>
  </div>
</div>

<style>
  .homescreen {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1a1b1d;
    color: #dfe1e5;
  }

  .homescreen-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 40px;
  }

  .logo {
    opacity: 0.9;
  }

  .title {
    font-size: 28px;
    font-weight: 600;
    color: #ffffff;
    margin: 0;
  }

  .subtitle {
    font-size: 15px;
    color: #7e8185;
    margin: 0;
    margin-top: -16px;
  }

  .actions {
    display: flex;
    gap: 12px;
    margin-top: 8px;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    border-radius: 8px;
    border: none;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 150ms ease;
    font-family: inherit;
  }

  .btn-primary {
    background: #4e7bf0;
    color: white;
  }

  .btn-primary:hover {
    background: #5a8af5;
    transform: translateY(-1px);
  }

  .btn-secondary {
    background: #2b2d30;
    color: #dfe1e5;
    border: 1px solid #3c3f41;
  }

  .btn-secondary:hover {
    background: #33353a;
    border-color: #4e7bf0;
  }

  .shortcuts {
    display: flex;
    gap: 24px;
    margin-top: 16px;
    padding-top: 24px;
    border-top: 1px solid #2d2f33;
  }

  .shortcut {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #7e8185;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    background: #2b2d30;
    border: 1px solid #3c3f41;
    border-radius: 4px;
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    color: #dfe1e5;
  }
</style>
