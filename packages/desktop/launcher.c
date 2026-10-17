#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

int main(int argc, char **argv) {
  (void)argc;
  char executable[PATH_MAX], resolved[PATH_MAX], runtime[PATH_MAX], initializer[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0 || !realpath(executable, resolved)) return 1;
  char *slash = strrchr(resolved, '/');
  if (!slash) return 1;
  *slash = '\0';
  if (snprintf(runtime, sizeof(runtime), "%s/DSH", resolved) >= (int)sizeof(runtime) ||
      snprintf(initializer, sizeof(initializer), "%s/../Resources/kaitu-loader.mjs", resolved) >= (int)sizeof(initializer)) return 1;
  char state[PATH_MAX];
  const char *home = getenv("HOME");
  const char *custom_state = getenv("KAITU_APP_HOME");
  if (custom_state && custom_state[0]) {
    if (custom_state[0] != '/' || snprintf(state, sizeof(state), "%s", custom_state) >= (int)sizeof(state)) return 1;
  } else if (!home || snprintf(state, sizeof(state), "%s/.kaitu-app", home) >= (int)sizeof(state)) return 1;
  if (setenv("DSH_HOME", state, 1) != 0) return 1;
  // 使用原生入口，使签名无需依赖脚本的扩展属性；参数通过 exec 原样传递。
  pid_t child = fork();
  if (child == -1) return 1;
  if (child == 0) {
    setenv("ELECTRON_RUN_AS_NODE", "1", 1);
    execl(runtime, runtime, initializer, (char *)NULL);
    perror("Kaitu initialize");
    _exit(1);
  }
  int status;
  if (waitpid(child, &status, 0) == -1 || !WIFEXITED(status) || WEXITSTATUS(status) != 0) return 1;
  unsetenv("ELECTRON_RUN_AS_NODE");
  argv[0] = runtime;
  execv(runtime, argv);
  perror("Kaitu launch");
  return 1;
}
