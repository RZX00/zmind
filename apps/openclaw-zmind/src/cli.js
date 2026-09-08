function registerCliCommands(program, clientFactory) {
  const zmind = program.command('zmind').description('Connected ZMind commands');

  zmind
    .command('login')
    .requiredOption('--email <email>')
    .requiredOption('--password <password>')
    .option('--backend-url <url>')
    .option('--supabase-url <url>')
    .option('--supabase-anon-key <key>')
    .action(async (options) => {
      const client = clientFactory();
      const result = await client.loginWithPassword({
        email: options.email,
        password: options.password,
        backendUrl: options.backendUrl,
        supabaseUrl: options.supabaseUrl,
        supabaseAnonKey: options.supabaseAnonKey,
      });
      process.stdout.write(`Signed in as ${result.user && result.user.email ? result.user.email : 'unknown'}\n`);
    });

  zmind
    .command('status')
    .action(async () => {
      const client = clientFactory();
      const result = await client.getStatus();
      if (!result.loggedIn) {
        process.stdout.write('Not signed in\n');
        return;
      }
      process.stdout.write(`Signed in as ${result.session.user.email}\n`);
    });

  zmind
    .command('workspace')
    .requiredOption('--id <workspaceId>')
    .action(async (options) => {
      const client = clientFactory();
      const workspace = await client.useWorkspace({
        workspaceId: options.id,
      });
      process.stdout.write(`Using workspace ${workspace.name} (${workspace.id})\n`);
    });

  zmind
    .command('logout')
    .action(async () => {
      const client = clientFactory();
      await client.logout();
      process.stdout.write('Signed out from ZMind\n');
    });
}

module.exports = {
  registerCliCommands,
};
