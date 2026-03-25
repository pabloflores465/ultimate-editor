<script>
  import Router from "svelte-spa-router";
  import routesArray from "~pages";
  import "./app.css";
  import WorkspaceSwitcher from "./components/WorkspaceSwitcher.svelte";

  const routes = Object.fromEntries(
    routesArray.map((r) => [r.path, r.component])
  );
</script>

<WorkspaceSwitcher>
  <Router {routes} />
</WorkspaceSwitcher>
