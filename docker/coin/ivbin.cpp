// ivbin in.iv out.iv: an ASCII Inventor file written again as binary (Coin's SoOutput::setBinary).
#include <Inventor/SoDB.h>
#include <Inventor/nodekits/SoNodeKit.h>
#include <Inventor/SoInput.h>
#include <Inventor/SoOutput.h>
#include <Inventor/actions/SoWriteAction.h>
#include <Inventor/nodes/SoSeparator.h>
#include <cstdio>
int main(int argc, char** argv) {
  SoDB::init();
  SoNodeKit::init();
  if (argc != 3) { fprintf(stderr, "usage: ivbin in.iv out.iv\n"); return 2; }
  SoInput in;
  if (!in.openFile(argv[1])) return 1;
  SoSeparator* root = SoDB::readAll(&in);
  if (!root) { fprintf(stderr, "read failed\n"); return 1; }
  root->ref();
  SoOutput out;
  if (!out.openFile(argv[2])) return 1;
  out.setBinary(TRUE);
  SoWriteAction wa(&out);
  // readAll wraps what it read in a Separator: write what's in it.
  if (root->getNumChildren() == 1) wa.apply(root->getChild(0)); else wa.apply(root);
  out.closeFile();
  return 0;
}
