package com.u1.slicer

import com.u1.slicer.data.BambuConfig
import com.u1.slicer.data.BambuModel
import com.u1.slicer.data.Printer
import com.u1.slicer.data.PrinterKind
import com.u1.slicer.slice.SlicerTarget
import org.junit.Assert.assertEquals
import org.junit.Test

class NightPrintOfflineA1MiniTargetTest {
    @Test fun usesA1MiniEvenWithoutLANConnection() {
        assertEquals(SlicerTarget.BambuA1Mini, nightPrintOfflineA1MiniTarget(null))
    }

    @Test fun configuredA1MiniRetainsItsTarget() {
        val active = Printer(
            id = "test", nickname = "A1 mini",
            kind = PrinterKind.BAMBU_LAN,
            bambu = BambuConfig(
                ip = "192.0.2.1", accessCode = "", serial = "",
                model = BambuModel.A1_MINI
            )
        )
        assertEquals(SlicerTarget.BambuA1Mini, nightPrintOfflineA1MiniTarget(active))
    }

    @Test fun wrongConfiguredPrinterIsNotSilentlyReinterpreted() {
        val active = Printer(
            id = "test", nickname = "Other printer",
            kind = PrinterKind.MOONRAKER
        )
        assertEquals(SlicerTarget.SnapmakerU1, nightPrintOfflineA1MiniTarget(active))
    }
}
