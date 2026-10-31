#include <libgen.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  char executable[PATH_MAX];
  if (!realpath(argv[0], executable)) return 1;
  char first[PATH_MAX], second[PATH_MAX];
  strlcpy(first, executable, sizeof(first));
  strlcpy(second, dirname(first), sizeof(second));
  char *contents = dirname(second);
  char project[PATH_MAX], server[PATH_MAX];
  snprintf(project, sizeof(project), "%s/Resources/app", contents);
  snprintf(server, sizeof(server), "%s/server.js", project);

  const char *candidates[] = {"/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node", NULL};
  const char *node = NULL;
  for (int i = 0; candidates[i]; i++) if (access(candidates[i], X_OK) == 0) { node = candidates[i]; break; }
  if (!node) {
    system("/usr/bin/osascript -e 'display alert \"Space Lens needs Node.js\" message \"Install Node.js 18 or newer from nodejs.org, then open Space Lens again.\"'");
    return 1;
  }

  pid_t pid = fork();
  if (pid == 0) {
    chdir(project);
    int nullfd = fileno(fopen("/dev/null", "w"));
    dup2(nullfd, STDOUT_FILENO); dup2(nullfd, STDERR_FILENO);
    execl(node, node, server, NULL);
    _exit(1);
  }
  sleep(2);
  system("/usr/bin/open http://127.0.0.1:43110");
  return 0;
}
