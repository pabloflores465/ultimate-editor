<script>
  import Router from "svelte-spa-router";
  import routesArray from "~pages";
  import "./app.css";

  const routes = Object.fromEntries(
    routesArray.map((r) => [r.path, r.component])
  );
</script>

<Router {routes} />
