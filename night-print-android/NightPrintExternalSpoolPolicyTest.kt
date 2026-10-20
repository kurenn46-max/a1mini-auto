package com.u1.slicer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NightPrintExternalSpoolPolicyTest {
    @Test fun a1MiniSingleExternalDoesNotUseAms() {
        val route = NightPrintExternalSpoolPolicy.singleLoadedExternalRoute(true, listOf(254))
        assertEquals(254, route)
        assertFalse(NightPrintExternalSpoolPolicy.useAms(route))
        assertNull(NightPrintExternalSpoolPolicy.mappingIssue(route, listOf(254)))
    }

    @Test fun mismatchedRouteIsRejectedRatherThanSentAsAms() {
        val route = NightPrintExternalSpoolPolicy.singleLoadedExternalRoute(true, listOf(254))
        assertNotNull(NightPrintExternalSpoolPolicy.mappingIssue(route, listOf(0)))
        assertNotNull(NightPrintExternalSpoolPolicy.mappingIssue(route, emptyList()))
        assertNotNull(NightPrintExternalSpoolPolicy.mappingIssue(route, listOf(254, -1)))
    }

    @Test fun neverInventExternalWhenStatusIsMissing() {
        assertNull(NightPrintExternalSpoolPolicy.singleLoadedExternalRoute(true, emptyList()))
        assertNull(NightPrintExternalSpoolPolicy.singleLoadedExternalRoute(true, listOf(0, 254)))
        assertNull(NightPrintExternalSpoolPolicy.singleLoadedExternalRoute(true, listOf(254, 255)))
        assertNull(NightPrintExternalSpoolPolicy.singleLoadedExternalRoute(false, listOf(254)))
        assertTrue(NightPrintExternalSpoolPolicy.useAms(null))
    }
}
