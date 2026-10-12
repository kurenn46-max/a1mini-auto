package com.u1.slicer

import com.u1.slicer.data.OverrideMode
import com.u1.slicer.data.OverrideValue
import com.u1.slicer.data.SlicingOverrides

/**
 * V4.1 preview: support overrides only. No printer, material or temperature changes.
 * Standard releases support controls back to the imported file profile.
 */
enum class NightPrintSupportLevel(val title: String, val description: String) {
    NONE("なし", "空中造形がないモデルだけ。プレビューで要確認"),
    LIGHT("少なめ", "ツリー・55°・ベッドからのみ・接触を控えめに"),
    STANDARD("標準", "3MFに記録されたサポート設定を使う"),
    STRONG("多め", "ツリー・35°・補助を多めにする")
}

object NightPrintSupportModes {
    /**
     * The pinned Android native Bambu bridge assigns support_threshold_angle as a
     * ConfigOptionFloat, but Orca defines it as ConfigOptionInt. Passing this
     * key in bambuExplicitOverrides throws "ConfigOptionSingle: Assigning an
     * incompatible type" when a support amount preset is selected.
     *
     * Keep the angle in the embedded process profile. ONLY remove the unsafe
     * JNI repeat-write; do not remove it from the profile map.
     */
    fun safeBambuNativeOverrideKeys(keys: Set<String>): String =
        keys.asSequence()
            .filterNot { it == "support_threshold_angle" }
            .joinToString(separator = "|", prefix = "|", postfix = "|")

    fun apply(level: NightPrintSupportLevel, old: SlicingOverrides): SlicingOverrides {
        fun <T> set(value: T) = OverrideValue(OverrideMode.OVERRIDE, value)
        fun <T> file() = OverrideValue<T>(OverrideMode.USE_FILE)
        return when (level) {
            NightPrintSupportLevel.NONE -> old.copy(
                supports = set(false),
                supportType = file(),
                supportAngle = file(),
                supportBuildPlateOnly = file(),
                supportPatternSpacing = file(),
                supportXyDistance = file()
            )
            NightPrintSupportLevel.LIGHT -> old.copy(
                supports = set(true),
                supportType = set("tree(auto)"),
                supportAngle = set(55),
                supportBuildPlateOnly = set(true),
                supportPatternSpacing = set(4.0f),
                supportXyDistance = set(0.50f)
            )
            NightPrintSupportLevel.STANDARD -> old.copy(
                supports = file(),
                supportType = file(),
                supportAngle = file(),
                supportBuildPlateOnly = file(),
                supportPatternSpacing = file(),
                supportXyDistance = file()
            )
            NightPrintSupportLevel.STRONG -> old.copy(
                supports = set(true),
                supportType = set("tree(auto)"),
                supportAngle = set(35),
                supportBuildPlateOnly = set(false),
                supportPatternSpacing = set(2.5f),
                supportXyDistance = set(0.35f)
            )
        }
    }
}
