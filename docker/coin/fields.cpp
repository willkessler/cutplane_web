// Every Inventor node type Coin knows (not VRML 2.0's), with its fields' types:
// "Name field:Type field:Type ...", and "+" after the name if it's a group.
#include <Inventor/SoDB.h>
#include <Inventor/SoType.h>
#include <Inventor/nodes/SoNode.h>
#include <Inventor/nodes/SoGroup.h>
#include <Inventor/nodekits/SoNodeKit.h>
#include <Inventor/fields/SoFieldData.h>
#include <Inventor/fields/SoField.h>
#include <Inventor/lists/SoTypeList.h>
#include <cstdio>
#include <cstring>
int main() {
  SoDB::init();
  SoNodeKit::init();
  SoTypeList all;
  SoType::getAllDerivedFrom(SoNode::getClassTypeId(), all);
  for (int i = 0; i < all.getLength(); i++) {
    SoType t = all[i];
    if (!t.canCreateInstance()) continue;
    const char* name = t.getName().getString();
    if (!strncmp(name, "VRML", 4)) continue;
    SoNode* n = (SoNode*)t.createInstance();
    n->ref();
    if (n->getNodeType() == SoNode::VRML2) { n->unref(); continue; }
    const SoFieldData* fd = n->getFieldData();
    printf("%s%s", name, t.isDerivedFrom(SoGroup::getClassTypeId()) ? "+" : "");
    for (int k = 0; fd && k < fd->getNumFields(); k++)
      printf(" %s:%s", fd->getFieldName(k).getString(), fd->getField(n, k)->getTypeId().getName().getString());
    printf("\n");
    n->unref();
  }
}
