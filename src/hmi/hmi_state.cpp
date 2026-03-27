#include "hmi_state.h"
#include "../web/webserver.h"

String buildHmiStateJson()
{
    return buildWsStateJsonForHmi();
}

String buildHmiAnalogJson()
{
    return buildWsAnalogJsonForHmi();
}